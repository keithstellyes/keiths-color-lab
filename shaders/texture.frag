#version 300 es

in vec2 fragUV;

uniform sampler2D u_texture;

out vec4 FragColor;

void main()
{
    // texture() decoded sRGB to linear on the way in, so this has to encode
    // on the way back out or the "unmodified" image comes out too dark.
    vec4 sampled = texture(u_texture, fragUV);
    FragColor = vec4(linearToSrgb(sampled.rgb), sampled.a);
}
