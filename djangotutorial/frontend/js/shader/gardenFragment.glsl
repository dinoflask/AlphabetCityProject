varying vec3 vColor;
varying float vFade;

void main() {
  // Light, glowy blob: a solid-ish bright core with a soft halo around it, so the
  // ocean reads gently rather than as hard, high-contrast dots.
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = smoothstep(0.44, 0.30, d);        // near-solid center
  float halo = smoothstep(0.5, 0.0, d) * 0.55;   // soft glow ring
  float alpha = max(core, halo);
  gl_FragColor = vec4(vColor, alpha * vFade);
}
