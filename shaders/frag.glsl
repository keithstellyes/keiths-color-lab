#version 300 es
precision mediump float;

out vec4 FragColor;

in vec2 fragCoord;
void main()
{
    FragColor = vec4((sin(fragCoord.x) + 1.0) / 3.0,
            (sin(fragCoord.y) + 1.0) / 3.0,
            0.1, 1.0);
}

