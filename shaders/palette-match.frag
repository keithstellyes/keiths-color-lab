#version 300 es

// Paint every pixel with the closest color out of a palette. The palette comes
// in as a flat array of vec3 sRGB code values -- see components/palette.js for
// where those come from -- and u_paletteSize says how much of the array is
// real, since the array itself has to be a fixed size.
#define MAX_PALETTE_SIZE 256

in vec2 fragUV;

uniform sampler2D u_texture;
uniform vec3 u_palette[MAX_PALETTE_SIZE];
uniform float u_paletteSize;
uniform bool u_dither;

out vec4 FragColor;

float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float distanceSquared(vec3 a, vec3 b)
{
    vec3 d = a - b;

    // The square root is monotonic, so leaving it off ranks the palette the
    // same way for less work.
    return dot(d, d);
}

void main()
{
    // The palette was clustered in sRGB code values, so the pixel has to be
    // encoded before it is compared against it. Distance here is plain
    // Euclidean, which treats a step in blue as mattering as much as a step in
    // green -- not true of eyes, but it is the distance the palette itself was
    // built with.
    vec3 color = linearToSrgb(texture(u_texture, fragUV).rgb);

    int count = int(u_paletteSize);

    // The two closest entries, tracked together because dithering needs the
    // runner-up as well.
    int best = 0;
    int runnerUp = 0;
    float bestDistance = 1.0e9;
    float runnerUpDistance = 1.0e9;

    for (int i = 0; i < MAX_PALETTE_SIZE; i++) {
        if (i >= count) {
            break;
        }

        float d = distanceSquared(color, u_palette[i]);

        if (d < bestDistance) {
            runnerUpDistance = bestDistance;
            runnerUp = best;
            bestDistance = d;
            best = i;
        } else if (d < runnerUpDistance) {
            runnerUpDistance = d;
            runnerUp = i;
        }
    }

    vec3 chosen = u_palette[best];

    // Dithering between the two closest entries instead of jittering the pixel
    // first: a palette has no fixed spacing to scale noise against, but the gap
    // between the two colors a pixel is actually deciding between is exactly
    // the error being hidden. Project the pixel onto the line joining them and
    // take the far one that often, and an area of flat color averages back out
    // to where the pixel really sat.
    if (u_dither) {
        vec3 near = u_palette[best];
        vec3 far = u_palette[runnerUp];
        vec3 between = far - near;
        float length2 = dot(between, between);

        float t = length2 > 0.0
            ? clamp(dot(color - near, between) / length2, 0.0, 1.0)
            : 0.0;

        if (hash(gl_FragCoord.xy) < t) {
            chosen = far;
        }
    }

    // Palette entries are already code values, so they go straight out.
    FragColor = vec4(chosen, 1.0);
}
