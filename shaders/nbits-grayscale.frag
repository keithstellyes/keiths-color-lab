#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;
// How many bits of gray to keep, e.g. 1.0, 2.0, 4.0, 8.0
uniform float u_bits;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    // Luminance in linear light, then encoded, because the quantizer below
    // has to run on the *encoded* value. Real n-bit gray hardware stores
    // evenly spaced code values, not evenly spaced intensities. Bucketing
    // linear light instead would spend nearly all the levels on highlights:
    // at 8 bits one linear step spans sRGB codes 0 through 13, so the whole
    // shadow range would collapse into the first bucket or two.
    float y = linearToSrgb(luminance(sampled.rgb));

    // n bits gives 2^n evenly sized buckets of gray. max() keeps the
    // divides below safe if u_bits was never set (it defaults to 0.0).
    float buckets = max(pow(2.0, u_bits), 2.0);

    // floor() picks the bucket, and the last bucket needs clamping since
    // y == 1.0 would otherwise land one past the end. Dividing by
    // buckets - 1 stretches the darkest bucket to black and the
    // brightest to white.
    float bucket = min(floor(y * buckets), buckets - 1.0);
    y = bucket / (buckets - 1.0);

    // Already an encoded value, so it goes straight out.
    FragColor = vec4(y, y, y, 1.0);
}
