// Lloyd's algorithm (k-means) over the colors of an image: the palette is the
// set of cluster centers, so the colors it spends its entries on are the ones
// the image actually uses instead of an even grid over the whole color cube.
//
// Everything here works on sRGB code values, not linear light. The image is
// bound as rgba8unorm rather than rgba8unorm-srgb, so textureLoad hands back
// exactly the bytes that were in the file, and the WebGL shader that later
// matches pixels against this palette quantizes in the same space.

struct Params {
    imageSize: vec2<u32>,
    // How many samples to take across each axis. A palette does not get
    // meaningfully better from looking at every pixel of a 12MP photo, and
    // bounding the sample count also bounds the fixed-point sums below.
    sampleSize: vec2<u32>,
    paletteSize: u32,
    // Which pass this is, so re-seeding a dead center picks a different pixel
    // every time instead of dropping it back where it already failed.
    iteration: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var image: texture_2d<f32>;

// rgb is the center, w is unused -- vec4 because a vec3 in an array is padded
// out to 16 bytes anyway, and saying so keeps the JS side honest.
@group(0) @binding(2) var<storage, read_write> centroids: array<vec4<f32>>;

// Four entries per cluster: red, green, blue, count. Atomics are integer only,
// so the channels accumulate as fixed point. The worst case is
// 256*256 samples * 4096, which is about 268M and well inside a u32.
@group(0) @binding(3) var<storage, read_write> sums: array<atomic<u32>>;

const FIXED_SCALE: f32 = 4096.0;

fn sampleCount() -> u32 {
    return params.sampleSize.x * params.sampleSize.y;
}

// Sample i sits at the center of the block of the image it stands for, so the
// samples are spread evenly instead of clustering in one corner.
fn samplePixel(i: u32) -> vec3<f32> {
    let sx = i % params.sampleSize.x;
    let sy = i / params.sampleSize.x;

    let x = (f32(sx) + 0.5) * f32(params.imageSize.x) / f32(params.sampleSize.x);
    let y = (f32(sy) + 0.5) * f32(params.imageSize.y) / f32(params.sampleSize.y);

    let coord = min(vec2<u32>(u32(x), u32(y)), params.imageSize - vec2<u32>(1u));

    return textureLoad(image, coord, 0).rgb;
}

// PCG-style integer hash, used to scatter the initial cluster centers.
fn hashU32(value: u32) -> u32 {
    var x = value * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;

    return (x >> 22u) ^ x;
}

fn distanceSquared(a: vec3<f32>, b: vec3<f32>) -> f32 {
    let d = a - b;

    return dot(d, d);
}

fn nearestCentroid(color: vec3<f32>) -> u32 {
    var best = 0u;
    var bestDistance = distanceSquared(color, centroids[0].rgb);

    for (var k = 1u; k < params.paletteSize; k++) {
        let distance = distanceSquared(color, centroids[k].rgb);

        if (distance < bestDistance) {
            bestDistance = distance;
            best = k;
        }
    }

    return best;
}

// Forgy initialization: every center starts on a pixel of the image, picked by
// a hash so the seeds are scattered rather than walking the image in order.
// Starting from real colors matters -- a center seeded somewhere the image
// never goes wins no pixels and stays where it was put.
@compute @workgroup_size(64)
fn seed(@builtin(global_invocation_id) id: vec3<u32>) {
    let k = id.x;

    if (k >= params.paletteSize) {
        return;
    }

    centroids[k] = vec4<f32>(samplePixel(hashU32(k) % sampleCount()), 1.0);
}

// One pass over the samples: each one votes for the center it is closest to.
@compute @workgroup_size(64)
fn assign(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;

    if (i >= sampleCount()) {
        return;
    }

    let color = samplePixel(i);
    let base = nearestCentroid(color) * 4u;

    atomicAdd(&sums[base], u32(color.r * FIXED_SCALE));
    atomicAdd(&sums[base + 1u], u32(color.g * FIXED_SCALE));
    atomicAdd(&sums[base + 2u], u32(color.b * FIXED_SCALE));
    atomicAdd(&sums[base + 3u], 1u);
}

// Move each center to the average of the samples that voted for it.
@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) id: vec3<u32>) {
    let k = id.x;

    if (k >= params.paletteSize) {
        return;
    }

    let base = k * 4u;
    let count = atomicLoad(&sums[base + 3u]);

    // Nothing voted for this center. Usually that means two centers were
    // seeded on the same color and the tie-break above always went to the
    // lower one, which leaves this a wasted palette entry -- so drop it
    // somewhere else in the image and let the next pass sort it out.
    if (count == 0u) {
        let scatter = hashU32(k + params.iteration * 2654435761u);

        centroids[k] = vec4<f32>(samplePixel(scatter % sampleCount()), 1.0);

        return;
    }

    let scale = 1.0 / (f32(count) * FIXED_SCALE);

    centroids[k] = vec4<f32>(
        f32(atomicLoad(&sums[base])) * scale,
        f32(atomicLoad(&sums[base + 1u])) * scale,
        f32(atomicLoad(&sums[base + 2u])) * scale,
        1.0
    );
}
