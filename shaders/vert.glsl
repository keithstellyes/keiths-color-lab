#version 300 es
precision mediump float;

layout (location=0) in vec2 pos;

out vec2 fragCoord;
void main()
{
    gl_Position = vec4(pos.x, pos.y, 1.0, 1.0);
    fragCoord = pos;
}
