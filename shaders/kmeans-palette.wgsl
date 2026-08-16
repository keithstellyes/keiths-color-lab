// Lloyd's algorithm (k-means) over the colors of an image: the palette is the
// set of cluster centers, so the colors it spends its entries on are the ones
// the image actually uses instead of an even grid over the whole color cube.
//
// Several palettes are clustered at once. They all read the same image and the
// same samples, and nothing about one palette's centers affects another's, so
// the palette index is just the y axis of the dispatch: every entry point picks
// its palette out of the table below and then works only inside that palette's
// slice of the shared buffers.
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
    // Which pass this is, so re-seeding a dead center picks a different pixel
    // every time instead of dropping it back where it already failed.
    iteration: u32,
};

// Where one palette's entries start in the buffers below, and how many it has.
// The sizes differ from palette to palette, so the layout is handed in rather
// than derived from a single count.
struct Palette {
    offset: u32,
    size: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var image: texture_2d<f32>;

// rgb is the center, w is unused -- vec4 because a vec3 in an array is padded
// out to 16 bytes anyway, and saying so keeps the JS side honest. Every
// palette's entries live in this one buffer, back to back.
@group(0) @binding(2) var<storage, read_write> centroids: array<vec4<f32>>;

// Four entries per cluster: red, green, blue, count. Atomics are integer only,
// so the channels accumulate as fixed point. The worst case is
// 256*256 samples * 4096, which is about 268M and well inside a u32.
@group(0) @binding(3) var<storage, read_write> sums: array<atomic<u32>>;

@group(0) @binding(4) var<storage, read> palettes: array<Palette>;

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

fn nearestCentroid(color: vec3<f32>, palette: Palette) -> u32 {
    var best = 0u;
    var bestDistance = distanceSquared(color, centroids[palette.offset].rgb);

    for (var k = 1u; k < palette.size; k++) {
        let distance = distanceSquared(color, centroids[palette.offset + k].rgb);

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
    let palette = palettes[id.y];
    let k = id.x;

    if (k >= palette.size) {
        return;
    }

    centroids[palette.offset + k] =
        vec4<f32>(samplePixel(hashU32(k) % sampleCount()), 1.0);
}

// One pass over the samples: each one votes for the center it is closest to.
// Each palette votes over the whole sample set, into its own counters.
@compute @workgroup_size(64)
fn assign(@builtin(global_invocation_id) id: vec3<u32>) {
    let palette = palettes[id.y];
    let i = id.x;

    if (i >= sampleCount()) {
        return;
    }

    let color = samplePixel(i);
    let base = (palette.offset + nearestCentroid(color, palette)) * 4u;

    atomicAdd(&sums[base], u32(color.r * FIXED_SCALE));
    atomicAdd(&sums[base + 1u], u32(color.g * FIXED_SCALE));
    atomicAdd(&sums[base + 2u], u32(color.b * FIXED_SCALE));
    atomicAdd(&sums[base + 3u], 1u);
}

// Move each center to the average of the samples that voted for it.
@compute @workgroup_size(64)
fn update(@builtin(global_invocation_id) id: vec3<u32>) {
    let palette = palettes[id.y];
    let k = id.x;

    if (k >= palette.size) {
        return;
    }

    let base = (palette.offset + k) * 4u;
    let count = atomicLoad(&sums[base + 3u]);

    // Nothing voted for this center. Usually that means two centers were
    // seeded on the same color and the tie-break above always went to the
    // lower one, which leaves this a wasted palette entry -- so drop it
    // somewhere else in the image and let the next pass sort it out.
    if (count == 0u) {
        let scatter = hashU32(k + params.iteration * 2654435761u);

        centroids[palette.offset + k] =
            vec4<f32>(samplePixel(scatter % sampleCount()), 1.0);

        return;
    }

    let scale = 1.0 / (f32(count) * FIXED_SCALE);

    centroids[palette.offset + k] = vec4<f32>(
        f32(atomicLoad(&sums[base])) * scale,
        f32(atomicLoad(&sums[base + 1u])) * scale,
        f32(atomicLoad(&sums[base + 2u])) * scale,
        1.0
    );
}
