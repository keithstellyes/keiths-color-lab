// computePalette(image, bits) -> Float32Array of 3 * 2^bits sRGB code values,
// the colors an image would keep if it could only afford `bits` bits per pixel.
// The clustering runs in a WebGPU compute shader; see
// shaders/kmeans-palette.wgsl for the algorithm and the color space.

// Lloyd's algorithm converges fast and then crawls, so a fixed iteration count
// is easier to reason about than a moving-centroid threshold that would need a
// readback every pass to test.
const PALETTE_ITERATIONS = 12;

// Samples taken along each axis, so at most 65536 pixels are clustered. Both
// the WGSL fixed-point sums and the wall-clock cost depend on this.
const PALETTE_SAMPLES_PER_AXIS = 256;

// Photos routinely come in wider than a GPU's maximum texture size, and the
// sampling above means the extra detail would be thrown away regardless.
const PALETTE_MAX_UPLOAD = 2048;

const PALETTE_WORKGROUP_SIZE = 64;

const PALETTE_MAX_BITS = 8;

// Resolved against this file rather than the page, so a shader path does not
// have to be threaded through every caller the way the components do it.
const PALETTE_SHADER_URL =
    new URL("../shaders/kmeans-palette.wgsl", document.currentScript.src);

// The device, the compiled module and the three pipelines are all reusable, and
// building them costs more than running them. Created on the first call so
// loading this file on a page that never asks for a palette is free.
let paletteContextPromise = null;

function paletteContext() {
    if (paletteContextPromise) {
        return paletteContextPromise;
    }

    paletteContextPromise = (async () => {
        if (!navigator.gpu) {
            throw new Error("WebGPU is not supported.");
        }

        const [adapter, code] = await Promise.all([
            navigator.gpu.requestAdapter(),
            fetch(PALETTE_SHADER_URL).then(response => {
                if (!response.ok) {
                    throw new Error(
                        `Failed to load compute shader: ${PALETTE_SHADER_URL}`
                    );
                }
                return response.text();
            })
        ]);

        if (!adapter) {
            throw new Error("No WebGPU adapter is available.");
        }

        const device = await adapter.requestDevice();
        const module = device.createShaderModule({ code });

        // Spelled out instead of taking the "auto" layout, so one bind group
        // can be shared by all three pipelines.
        const bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "uniform" }
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.COMPUTE,
                    texture: { sampleType: "float" }
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "storage" }
                }
            ]
        });

        const layout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        const pipelines = {};

        for (const entryPoint of ["seed", "assign", "update"]) {
            pipelines[entryPoint] = device.createComputePipeline({
                layout,
                compute: { module, entryPoint }
            });
        }

        return { device, bindGroupLayout, pipelines };
    })();

    return paletteContextPromise;
}

function paletteSourceSize(source) {
    // HTMLImageElement reports its intrinsic size separately from the size it
    // is laid out at; everything else (ImageBitmap, canvas) has one size.
    return [
        source.naturalWidth || source.width,
        source.naturalHeight || source.height
    ];
}

function paletteFitForUpload(image) {
    const [width, height] = paletteSourceSize(image);
    const longest = Math.max(width, height);

    if (longest <= PALETTE_MAX_UPLOAD) {
        return image;
    }

    const scale = PALETTE_MAX_UPLOAD / longest;
    const canvas = new OffscreenCanvas(
        Math.max(1, Math.round(width * scale)),
        Math.max(1, Math.round(height * scale))
    );

    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);

    return canvas;
}

function paletteDispatchCount(threads) {
    return Math.ceil(threads / PALETTE_WORKGROUP_SIZE);
}

// image: anything copyExternalImageToTexture accepts -- an already-decoded
// HTMLImageElement, an ImageBitmap, a canvas.
// bits: how many bits a pixel gets to spend on its palette index, 1 to 8.
async function computePalette(image, bits) {
    if (!Number.isInteger(bits) || bits < 1 || bits > PALETTE_MAX_BITS) {
        throw new Error(
            `Palette size must be a whole number of bits from 1 to ` +
            `${PALETTE_MAX_BITS}, got ${bits}.`
        );
    }

    const paletteSize = 2 ** bits;

    const { device, bindGroupLayout, pipelines } = await paletteContext();

    const source = paletteFitForUpload(image);
    const [width, height] = paletteSourceSize(source);

    const texture = device.createTexture({
        size: [width, height],
        // Not the -srgb variant: the clustering wants code values, and
        // RENDER_ATTACHMENT is what copyExternalImageToTexture writes through.
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING
            | GPUTextureUsage.COPY_DST
            | GPUTextureUsage.RENDER_ATTACHMENT
    });

    device.queue.copyExternalImageToTexture(
        { source },
        { texture },
        [width, height]
    );

    const sampleWidth = Math.min(width, PALETTE_SAMPLES_PER_AXIS);
    const sampleHeight = Math.min(height, PALETTE_SAMPLES_PER_AXIS);
    const sampleCount = sampleWidth * sampleHeight;

    const params = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });

    const writeParams = iteration => device.queue.writeBuffer(
        params,
        0,
        new Uint32Array([
            width, height,
            sampleWidth, sampleHeight,
            paletteSize, iteration, 0, 0
        ])
    );

    // vec4 per entry on both buffers: rgb + padding for the centroids, and
    // r/g/b/count for the sums.
    const bufferSize = paletteSize * 4 * Float32Array.BYTES_PER_ELEMENT;

    const centroids = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });

    const sums = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    const readback = device.createBuffer({
        size: bufferSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: params } },
            { binding: 1, resource: texture.createView() },
            { binding: 2, resource: { buffer: centroids } },
            { binding: 3, resource: { buffer: sums } }
        ]
    });

    // Every dispatch reads what the one before it wrote, so each gets its own
    // pass: passes are ordered against each other, and clearing the vote
    // counters has to happen outside a pass anyway.
    const dispatch = (encoder, pipeline, threads) => {
        const pass = encoder.beginComputePass();

        pass.setPipeline(pipelines[pipeline]);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(paletteDispatchCount(threads));
        pass.end();
    };

    // A queue write only lands between submits, and the shader wants to know
    // which iteration it is on, so an iteration is a submit.
    const submit = (build, iteration = 0) => {
        writeParams(iteration);

        const encoder = device.createCommandEncoder();

        build(encoder);
        device.queue.submit([encoder.finish()]);
    };

    submit(encoder => dispatch(encoder, "seed", paletteSize));

    for (let iteration = 0; iteration < PALETTE_ITERATIONS; iteration++) {
        submit(encoder => {
            encoder.clearBuffer(sums);
            dispatch(encoder, "assign", sampleCount);
            dispatch(encoder, "update", paletteSize);
        }, iteration);
    }

    submit(encoder =>
        encoder.copyBufferToBuffer(centroids, 0, readback, 0, bufferSize)
    );

    await readback.mapAsync(GPUMapMode.READ);

    const centers = new Float32Array(readback.getMappedRange());
    const palette = new Float32Array(paletteSize * 3);

    // Drop the padding lane on the way out: callers want a flat run of vec3s.
    for (let i = 0; i < paletteSize; i++) {
        palette[i * 3] = centers[i * 4];
        palette[i * 3 + 1] = centers[i * 4 + 1];
        palette[i * 3 + 2] = centers[i * 4 + 2];
    }

    readback.unmap();

    for (const resource of [texture, params, centroids, sums, readback]) {
        resource.destroy();
    }

    return palette;
}
