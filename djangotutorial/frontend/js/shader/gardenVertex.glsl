uniform float time;
uniform float uSpeed;       // how fast each particle cycles through its life
uniform float uCurlAmp;     // strength of the organic curl wobble
uniform float uFlowDist;    // how far a particle drifts over its life
uniform float uSize;        // global point-size multiplier
uniform vec3 uFlowDir;      // the "river" direction
uniform vec3 uMouse;        // mouse position projected onto the z=0 plane
uniform float uRevealRadius; // radius around the mouse that reveals edge particles
uniform float uBurst;        // screensaver scatter kick (0..1, decays)

attribute vec3 aColor;
attribute float aSize;
attribute float aSeed;
attribute float aEdge;      // 0 = core (always shown), 1 = rim (shown only near mouse)

varying vec3 vColor;
varying float vFade;

#include noise.glsl

void main() {
  vColor = aColor;

  // Per-particle looping life: drift along the flow, fade out, reappear at home.
  float life = fract(time * uSpeed + aSeed);
  vFade = sin(life * 3.14159265);            // 0 at birth/death, 1 mid-life (peak at home)

  vec3 pos = position;
  pos += uFlowDir * (life - 0.5) * uFlowDist;                 // slow one-direction river drift
  pos += curl(pos * 0.5 + vec3(0.0, 0.0, time * 0.02),        // brownian-like shimmer on top
              time * 0.05, 0.4) * uCurlAmp;

  // Screensaver "disruption": a stronger, faster curl kick that scatters the
  // particles when uBurst spikes, settling as it decays back to 0.
  pos += curl(pos * 1.7 + vec3(time * 0.15), time * 0.25, 0.7) * (uBurst * 0.7);

  // Edge reveal: rim particles are hidden until the mouse is near, then grow and
  // fade in (and shrink/fade out as it leaves). Core particles ignore the mouse.
  float reveal = smoothstep(uRevealRadius, 0.0, distance(pos.xy, uMouse.xy));
  float visible = mix(1.0, reveal, aEdge);   // aEdge 0 -> always 1; 1 -> follows the mouse
  vFade *= visible;

  vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = aSize * uSize * mix(0.15, 1.0, visible) * (1.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
