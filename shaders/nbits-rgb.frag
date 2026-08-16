#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;
uniform float u_redBits;
uniform float u_greenBits;
uniform float u_blueBits;
uniform bool u_dither;

out vec4 FragColor;

// White noise from the pixel's position. Each channel asks for its own value
// -- one shared number would push red, green and blue the same direction on
// the same pixel, which tints the error instead of hiding it.
float hash(vec2 p, float channel)
{
    return fract(sin(dot(p + channel * 37.0, vec2(12.9898, 78.233)))
                 * 43758.5453);
}

// Snap one channel down to one of 2^bits evenly spaced levels. At least two
// levels, so a 0-bit channel still has black and white rather than dividing by
// zero.
//
// The noise is scaled to exactly one bucket, which is the whole point of doing
// it here rather than before the call: a fixed amplitude that reads as a nice
// grain at 1 bit is a blizzard at 8. A channel sitting 30% of the way into its
// bucket now rounds up on 30% of its pixels, so an area of flat color averages
// back to the color that was asked for.
float quantize(float c, float bits, float noise)
{
    float buckets = max(pow(2.0, bits), 2.0);
    float bucket = clamp(floor(c * buckets + noise), 0.0, buckets - 1.0);

    return bucket / (buckets - 1.0);
}

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    // Quantizing happens in encoded space: the levels a display can actually
    // show are code values, evenly spaced there and not in linear light.
    vec3 encoded = linearToSrgb(sampled.rgb);

    vec3 noise = vec3(0.0);

    if (u_dither) {
        noise = vec3(
            hash(gl_FragCoord.xy, 0.0),
            hash(gl_FragCoord.xy, 1.0),
            hash(gl_FragCoord.xy, 2.0)
        );
    }

    FragColor = vec4(
        quantize(encoded.r, u_redBits, noise.r),
        quantize(encoded.g, u_greenBits, noise.g),
        quantize(encoded.b, u_blueBits, noise.b),
        1.0
    );
}
