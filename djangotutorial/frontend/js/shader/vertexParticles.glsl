uniform float time;
uniform sampler2D uPositions;
uniform float uHoverIndex;   // index of the hovered answer dot, or -1
uniform float uHoverAmt;     // eased 0..1 grow/glow amount (delayed)
attribute vec2 reference;
attribute vec3 aColor;
attribute float aScale;
attribute float aIsAnswer;
attribute float aIndex;
varying vec2 vUv;
varying vec3 vColor;
varying float vIsAnswer;
varying float vHover;
float PI = 3.141592653589793238;
void main() {
  vUv = uv;
  vColor = aColor;
  vIsAnswer = aIsAnswer;

  // Is this the currently-hovered dot? If so, apply the eased grow/glow amount
  // (which ramps in after a delay and eases back out on unhover).
  float hov = (uHoverIndex >= 0.0 && abs(aIndex - uHoverIndex) < 0.5) ? 1.0 : 0.0;
  float amt = hov * uHoverAmt;
  vHover = amt;

  vec3 pos = texture2D( uPositions, reference).xyz;
  pos.y = -pos.y;   // canvas Y is top-down; flip so the shape is right-side up

  vec4 mvPosition = modelViewMatrix * vec4( pos, 1. );
  gl_PointSize = aScale * 55. * (1.0 + amt * 0.7) * ( 1. / - mvPosition.z );
  gl_Position = projectionMatrix * mvPosition;
}
