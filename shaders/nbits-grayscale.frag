#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;
uniform float u_bits;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    float y = linearToSrgb(luminance(sampled.rgb));

    float buckets = max(pow(2.0, u_bits), 2.0);

    float bucket = min(floor(y * buckets), buckets - 1.0);
    y = bucket / (buckets - 1.0);

    // Already an encoded value, so it goes straight out.
    FragColor = vec4(y, y, y, 1.0);
}
