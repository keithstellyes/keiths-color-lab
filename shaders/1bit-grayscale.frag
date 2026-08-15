#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    // The naive version, deliberately: it averages the *encoded* channels,
    // which is what code reaching straight for the bytes of an image ends up
    // doing. Every later shader on this page fixes one thing about it.
    vec3 encoded = linearToSrgb(sampled.rgb);
    float y = (encoded.r + encoded.g + encoded.b) / 3.0;

    y = y > 0.5 ? 1.0 : 0.0;

    // Pure black and white are the same number in both spaces, so a binary
    // result needs no encoding on the way out.
    FragColor = vec4(y, y, y, 1.0);
}
