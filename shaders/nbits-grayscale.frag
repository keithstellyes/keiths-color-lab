#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;
uniform float u_bits;
uniform bool u_dither;

out vec4 FragColor;

float hash(vec2 p, vec4 srcColor)
{
    p.x *= srcColor.r;
    p.y *= srcColor.g;
    p.x *= srcColor.b;
    p.y *= srcColor.b;
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    float y = linearToSrgb(luminance(sampled.rgb));
    if(u_dither) {
        float r = 0.0;
        r = sin(hash(gl_FragCoord.xy, sampled)) / 2.0;
        // reduce its influence, from testing it seems to look a bit better this way
        r /= 4.0;
        y += r;
    }

    float buckets = max(pow(2.0, u_bits), 2.0);

    float bucket = min(floor(y * buckets), buckets - 1.0);
    y = bucket / (buckets - 1.0);

    // Already an encoded value, so it goes straight out.
    FragColor = vec4(y, y, y, 1.0);
}
