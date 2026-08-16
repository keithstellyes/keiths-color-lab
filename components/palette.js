// computePalettes(image, bitsList) -> one Float32Array of 3 * 2^bits sRGB code
// values per requested bit budget: the colors an image would keep if it could
// only afford `bits` bits per pixel. Every palette asked for is clustered in
// the same dispatches, since they all read the same image and none of them
// depends on any other; see shaders/kmeans-palette.wgsl for the algorithm, the
// buffer layout and the color space.

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
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: { type: "read-only-storage" }
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

// One (offset, size) pair per palette, laid out for binding 4: where each
// palette's entries start in the shared buffers, and how many it has.
function paletteLayout(bitsList) {
    const table = new Uint32Array(bitsList.length * 2);

    let offset = 0;

    bitsList.forEach((bits, index) => {
        const size = 2 ** bits;

        table[index * 2] = offset;
        table[index * 2 + 1] = size;

        offset += size;
    });

    return { table, totalEntries: offset };
}

// image: anything copyExternalImageToTexture accepts -- an already-decoded
// HTMLImageElement, an ImageBitmap, a canvas.
// bitsList: how many bits a pixel gets to spend on its palette index, 1 to 8,
// once per palette wanted. Repeats are allowed and are clustered separately.
// Returns a palette per entry of bitsList, in the same order.
async function computePalettes(image, bitsList) {
    if (!Array.isArray(bitsList)) {
        throw new Error("Palette sizes must be an array of bit counts.");
    }

    for (const bits of bitsList) {
        if (!Number.isInteger(bits) || bits < 1 || bits > PALETTE_MAX_BITS) {
            throw new Error(
                `Palette size must be a whole number of bits from 1 to ` +
                `${PALETTE_MAX_BITS}, got ${bits}.`
            );
        }
    }

    if (bitsList.length === 0) {
        return [];
    }

    const { table, totalEntries } = paletteLayout(bitsList);

    // The widest palette decides how many threads a seed or update dispatch
    // needs; the narrower ones leave their tail threads to return early.
    const widestPalette = 2 ** Math.max(...bitsList);

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
            iteration, 0, 0, 0
        ])
    );

    const layoutBuffer = device.createBuffer({
        size: table.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });

    device.queue.writeBuffer(layoutBuffer, 0, table);

    // vec4 per entry on both buffers, every palette's entries back to back:
    // rgb + padding for the centroids, and r/g/b/count for the sums.
    const bufferSize = totalEntries * 4 * Float32Array.BYTES_PER_ELEMENT;

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
            { binding: 3, resource: { buffer: sums } },
            { binding: 4, resource: { buffer: layoutBuffer } }
        ]
    });

    // Every dispatch reads what the one before it wrote, so each gets its own
    // pass: passes are ordered against each other, and clearing the vote
    // counters has to happen outside a pass anyway.
    //
    // The y axis is the palette, so all of them run in the same dispatch and
    // the GPU gets one pile of work to fill itself with instead of a queue of
    // small ones.
    const dispatch = (encoder, pipeline, threads) => {
        const pass = encoder.beginComputePass();

        pass.setPipeline(pipelines[pipeline]);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(paletteDispatchCount(threads), bitsList.length);
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

    submit(encoder => dispatch(encoder, "seed", widestPalette));

    for (let iteration = 0; iteration < PALETTE_ITERATIONS; iteration++) {
        submit(encoder => {
            encoder.clearBuffer(sums);
            dispatch(encoder, "assign", sampleCount);
            dispatch(encoder, "update", widestPalette);
        }, iteration);
    }

    submit(encoder =>
        encoder.copyBufferToBuffer(centroids, 0, readback, 0, bufferSize)
    );

    await readback.mapAsync(GPUMapMode.READ);

    const centers = new Float32Array(readback.getMappedRange());

    // Cut the one buffer back up into a palette per bit budget, dropping the
    // padding lane on the way out: callers want a flat run of vec3s.
    const results = bitsList.map((_, index) => {
        const offset = table[index * 2];
        const size = table[index * 2 + 1];
        const palette = new Float32Array(size * 3);

        for (let i = 0; i < size; i++) {
            palette[i * 3] = centers[(offset + i) * 4];
            palette[i * 3 + 1] = centers[(offset + i) * 4 + 1];
            palette[i * 3 + 2] = centers[(offset + i) * 4 + 2];
        }

        return palette;
    });

    readback.unmap();

    const resources =
        [texture, params, layoutBuffer, centroids, sums, readback];

    for (const resource of resources) {
        resource.destroy();
    }

    return results;
}
