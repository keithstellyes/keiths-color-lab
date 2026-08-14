#version 300 es
// highp is required: the hash below multiplies by a large constant, and
// mediump does not have enough mantissa left to make fract() meaningful.
precision highp float;

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

// Claude:
// The usual "one-liner" GLSL hash. sin() alone is far too smooth to be
// noise; scaling by a large constant and keeping only the fractional part
// is what shreds it into something uncorrelated pixel to pixel.
float hash(vec2 p)
{
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main()
{
    vec4 sampled = texture(u_texture, fragUV);
    // ITU-R Rec. 2020 luma coefficients; they sum to 1.0, so this is
    // already a weighted average -- no divide afterwards.
    float y = dot(sampled.rgb, vec3(0.2627, 0.6780, 0.0593));
    float r = (hash(gl_FragCoord.xy) - .5) * .5;
    y = y + r;
    y = y > 0.5 ? 1.0 : 0.0;
    FragColor = vec4(y, y, y, 1.0);
}
