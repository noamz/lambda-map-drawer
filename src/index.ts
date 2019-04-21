import { findConjoined } from './conjoined';
import { findGraph, findRootedGraph, findLambdaGraph } from './graph';
import { Loader } from './loader';
import * as u from './util';

const WIDTH = 16;
const EDGE_RAD = 7;
const NODE_RAD = 9;
function relpos(e: MouseEvent, n: Element): Point {
  const rect = n.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getCanvas(id: string): Canvas {
  const c = document.getElementById(id) as HTMLCanvasElement;
  const d = c.getContext('2d')!;
  c.width = 500;
  c.height = 500;
  d.fillStyle = "white";
  d.fillRect(0, 0, 500, 500);
  return { c, d };
}


function currentTool(): Tool {
  return (Array.from(document.getElementsByName('paint')) as HTMLFormElement[])
    .find(x => x.checked)!.value;
}

function sizeOfTool(t: Tool): number {
  switch (t) {
    case 'node': return WIDTH;
    case 'edge': return WIDTH / 2;
    case 'erase': return WIDTH * 2;
  }
}

function colorOfTool(t: Tool): string {
  switch (t) {
    case 'node': return 'red';
    case 'edge': return 'blue';
    case 'erase': return 'white';
  }
}

function renderConjoined(sa: SizedArray): ImageData {
  const id = new ImageData(sa.w, sa.h);
  for (let i = 0; i < sa.w; i++) {
    for (let j = 0; j < sa.h; j++) {
      const ix1 = (j * sa.w + i);
      const ix2 = 4 * (j * sa.w + i);
      id.data[ix2 + 0] = (sa.data[ix1] * 17) & 255;
      id.data[ix2 + 1] = (sa.data[ix1] * 71) & 255;
      id.data[ix2 + 2] = (sa.data[ix1] * 157) & 255;
      id.data[ix2 + 3] = sa.data[ix1] ? 128 : 0;
    }
  }
  return id;
}

function renderDebug(conj: ConjoinedData, c2: Canvas) {
  c2.d.putImageData(renderConjoined(conj.array), 0, 0);
  Object.keys(conj.avg).forEach(i => {
    const p = conj.avg[i];
    c2.d.fillStyle = "white";
    c2.d.fillRect(Math.floor(p.x) - 3, Math.floor(p.y) - 3, 6, 6);
  });
}



function renderCyclicOrdering(g: GraphData, c: Canvas) {
  const { d } = c;
  for (const v of Object.values(g.vertices)) {
    const colors = ["red", "green", "blue"];
    if (v.edges.length <= 3) {
      v.edges.forEach((e, i) => {
        const m = g.edges[e.i].m;
        const vec = u.vplus(u.vscale(u.vnorm(u.vsub(m, v.p)), 15), v.p);
        d.beginPath();
        d.moveTo(v.p.x, v.p.y);
        d.lineTo(vec.x, vec.y);
        d.strokeStyle = colors[i];
        d.lineWidth = 3;
        d.lineCap = 'round';
        d.stroke();
      });
    }
  }
}

function renderGraph(g: RootedGraphData, c: Canvas) {
  const { d } = c

  g.edges.forEach(({ a, b, m }, i) => {
    const va = g.vertices[a].p;
    const vb = g.vertices[b].p;
    d.beginPath();
    d.moveTo(va.x, va.y);
    d.quadraticCurveTo(
      2 * m.x - (va.x + vb.x) / 2,
      2 * m.y - (va.y + vb.y) / 2,
      vb.x, vb.y);
    d.strokeStyle = "black";
    d.lineWidth = 1;
    d.stroke();

    if (enabled('renderDebugId')) {
      d.beginPath();
      d.fillStyle = 'white';
      d.arc(m.x, m.y, EDGE_RAD, 0, Math.PI * 2);
      d.fill();
      d.textAlign = 'center';
      d.textBaseline = 'middle'
      d.font = 'bold 10px arial';
      d.fillStyle = '#404';
      d.fillText(i + '', m.x, m.y);
    }
  });
  for (let [k, { p }] of Object.entries(g.vertices)) {
    d.fillStyle = "#fed";

    if (g.vertices[k].edges.length != 3) {
      d.fillStyle = "red";
    }
    if (k == g.root) {
      d.fillStyle = "white";
    }
    d.strokeStyle = "black";
    d.lineWidth = 1;
    d.beginPath();
    d.arc(p.x, p.y, NODE_RAD, 0, 2 * Math.PI);
    d.fill();
    d.stroke();

    if (enabled('renderDebugId')) {
      d.textAlign = 'center';
      d.textBaseline = 'middle'
      d.font = 'bold 9px arial';
      d.fillStyle = '#000';
      d.fillText(k, p.x, p.y);
    }
  }
  if (enabled('renderLambda')) {
    d.save();
    d.fillStyle = "white";
    d.globalAlpha = 0.2;
    d.fillRect(0, 0, 500, 500);
    d.restore();
  }
}

function drawArrowHead(d: CanvasRenderingContext2D, m: Point, va: Point, vb: Point) {
  d.strokeStyle = "black";
  d.lineWidth = 1;
  d.stroke();
  d.save();
  d.translate(m.x, m.y);
  d.rotate(Math.atan2(vb.y - va.y, vb.x - va.x));
  d.beginPath();
  d.moveTo(0, -3);
  d.lineTo(2, 0);
  d.lineTo(0, 3);
  d.lineTo(8, 0);
  d.fillStyle = "black";
  d.fill();
  d.restore();
}

type From = 'lam' | 'appl' | 'appr' | 'top';
type StringifyRes = { s: string, counter: number };

function findSplit(e: Exp): { e: ExpS, size: number } {
  switch (e.t) {
    case 'lam': {
      const { e: e0, size: size0 } = findSplit(e.b);
      return { e: { t: 'lam', b: e0 }, size: size0 - 1 };
    }
    case 'app': {
      const { e: ef, size: sizef } = findSplit(e.f);
      const { e: ea, size: sizea } = findSplit(e.arg);
      return { e: { t: 'app', f: ef, arg: ea, split: sizef }, size: sizef + sizea };
    }
    case 'var': return { e, size: 1 };
  }
}

function stringifyLam(counter: number, G: string[], e: ExpS, frm: From): StringifyRes {
  switch (e.t) {
    case 'lam': {
      const v = String.fromCharCode(counter + 97);
      const bind = frm == 'lam' ? '' : '\u03bb';
      const res = stringifyLam(counter + 1, G.concat([v]), e.b, 'lam');
      const rv = bind + v + res.s;
      return {
        s: (frm == 'lam' || frm == 'top') ? rv : '(' + rv + ')',
        counter: res.counter,
      };
    }
    case 'app': {
      const pref = frm == 'lam' ? '.' : '';
      const res1 = stringifyLam(counter, G.slice(0, e.split), e.f, 'appl');
      const res2 = stringifyLam(res1.counter, G.slice(e.split), e.arg, 'appr');
      const rv = (pref + res1.s + ' ' + res2.s);
      return {
        s: frm == 'appr' ? '(' + rv + ')' : rv,
        counter: res2.counter
      };
    }
    case 'var': return { s: G[0], counter };
  }
}
function renderLambdaGraph(g: LambdaGraphData, c: Canvas) {
  const { d } = c
  g.edges.forEach((e) => {
    if (e == undefined) return;
    const { a, b, m, tgt } = e;
    if (g.vertices[a] == undefined) return;
    if (g.vertices[b] == undefined) return;
    const va = g.vertices[a].p;
    const vb = g.vertices[b].p;
    d.beginPath();
    d.moveTo(va.x, va.y);
    d.quadraticCurveTo(
      2 * m.x - (va.x + vb.x) / 2,
      2 * m.y - (va.y + vb.y) / 2,
      vb.x, vb.y);
    if (tgt == 'b')
      drawArrowHead(d, m, va, vb);
    else
      drawArrowHead(d, m, vb, va);
  });
  for (let [k, v] of Object.entries(g.vertices)) {
    if (v == undefined) return;
    const { p, t } = v;
    d.fillStyle = k == g.root ? "#aaf" : (t == 'app' ? 'white' : 'black');
    d.strokeStyle = "black";
    d.lineWidth = 1;
    d.beginPath();
    d.arc(p.x, p.y, NODE_RAD, 0, 2 * Math.PI);
    d.fill();
    d.stroke();
  }
  document.getElementById('lambda')!.innerText = stringifyLam(0, [], findSplit(g.exp).e, 'top').s;
}

function enabled(id: string): boolean {
  return (document.getElementById(id) as HTMLFormElement).checked;
}

function go() {
  const c1 = getCanvas('c1');
  c1.d.drawImage(l.data.img['sample'], 0, 0);
  const c2 = getCanvas('c2');

  ['renderDebug',
    'renderDebugId',
    'renderCyclic',
    'renderGraph',
    'renderLambda'].forEach(id => {
      document.getElementById(id)!.addEventListener('change', compute);
    });


  function compute() {
    c2.d.clearRect(0, 0, c2.c.width, c2.c.height);
    const dat = c1.d.getImageData(0, 0, c1.c.width, c1.c.height);
    const conj = findConjoined(dat);
    if (enabled('renderDebug')) renderDebug(conj, c2);
    const g = findGraph(conj);
    const rg = findRootedGraph(g);
    if (enabled('renderCyclic')) renderCyclicOrdering(rg, c2);
    if (enabled('renderGraph')) renderGraph(rg, c2);

    if (enabled('renderLambda')) {
      try {
        const lg = findLambdaGraph(rg);
        const exp = renderLambdaGraph(lg, c2);
      }
      catch (e) {
        document.getElementById('lambda')!.innerText = '';
        console.log(e);
        renderGraph(rg, c2);
      }
    }
  }

  //  document.getElementById('compute')!.addEventListener('click', compute);

  let prev: Point | undefined = undefined;

  function paint(p: Point) {
    p = u.vint(p);
    const t = currentTool();
    const size = sizeOfTool(t)
    c1.d.fillStyle = colorOfTool(t);
    c1.d.fillRect(p.x - size / 2, p.y - size / 2, size, size);
  }

  function paintLine(p: Point, q: Point) {
    if (Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y)) < WIDTH / 2) {
      paint(q);
    }
    else {
      const avg = {
        x: Math.floor((p.x + q.x) / 2),
        y: Math.floor((p.y + q.y) / 2)
      };
      paintLine(p, avg);
      paintLine(avg, q);
    }
  }

  function onMove(e: MouseEvent) {
    const p = relpos(e, c1.c);
    if (prev != undefined)
      paintLine(prev, p);
    else
      paint(p);
    prev = p;
  }

  function onMouseup(e: MouseEvent) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onMove);
    compute();
  }

  document.getElementById('clear')!.addEventListener('click', () => {
    c1.d.fillStyle = "white";
    c1.d.fillRect(0, 0, c1.c.width, c1.c.height);
    compute();
  });

  c1.c.addEventListener('mousedown', (e) => {
    if (e.buttons != 1) return;
    const p = relpos(e, c1.c);
    prev = p;
    paint(p);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onMouseup);
  });
  compute();

}

const l = new Loader();
l.image('/img/counterexample.png', 'sample');
l.done(go);
