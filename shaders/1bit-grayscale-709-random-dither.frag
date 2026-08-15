#version 300 es

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

    // Unlike the plain threshold next door, this one deliberately stays in
    // LINEAR light. What the eye averages over a patch of alternating black
    // and white pixels is the linear average, so for the dither to come out
    // at the right brightness we need P(white) to equal the linear
    // luminance -- not the encoded value.
    float y = luminance(sampled.rgb);

    // Uniform on +-0.5, which makes P(y + r > 0.5) exactly y. Any smaller
    // amplitude clips: at +-0.25 everything below 0.25 was forced to black
    // and everything above 0.75 to white, so only the middle half dithered.
    float r = sin(hash(gl_FragCoord.xy)) / 2.0;

    y = y + r;
    y = y > 0.5 ? 1.0 : 0.0;

    FragColor = vec4(y, y, y, 1.0);
}
