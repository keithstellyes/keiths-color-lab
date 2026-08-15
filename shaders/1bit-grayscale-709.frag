#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    vec4 sampled = texture(u_texture, fragUV);

    float y = luminance(sampled.rgb);

    y = linearToSrgb(y);

    y = y > 0.5 ? 1.0 : 0.0;

    FragColor = vec4(y, y, y, 1.0);
}
