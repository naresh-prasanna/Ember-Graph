/* Standalone, dependency-free numerical graphing. Expressions are parsed as
   mathematics, never executed as JavaScript. Numerical plots are approximate. */
export const $ = s => document.querySelector(s),
  cv = $('#c'),
  ctx = cv.getContext('2d');
