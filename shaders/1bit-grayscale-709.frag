#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    // Proper relative luminance, measured in linear light where "twice as
    // much green" actually means twice as many photons.
    float y = luminance(sampled.rgb);

    // Encode before thresholding so that 0.5 means the *perceptual* midpoint.
    // Cutting linear light at 0.5 would put the threshold up at sRGB 0.735
    // and turn most of the image black, which would swamp the one difference
    // this shader is here to demonstrate.
    y = linearToSrgb(y);

    y = y > 0.5 ? 1.0 : 0.0;

    FragColor = vec4(y, y, y, 1.0);
}
