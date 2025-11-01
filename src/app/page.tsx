"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Vec2 = { x: number; y: number };

type Collectible = {
  id: number;
  position: Vec2;
  taken: boolean;
  spin: number;
};

type UiState = {
  time: number;
  collected: number;
  distance: number;
  pace: number;
};

const SPEED = 280;
const FOLLOW_DELAY = 34;
const TRAIL_LIMIT = 180;
const EDGE_PADDING = 80;
const UI_INTERVAL = 120;

const KEY_DIRECTIONS: Record<string, Vec2> = {
  arrowup: { x: 0, y: -1 },
  w: { x: 0, y: -1 },
  arrowdown: { x: 0, y: 1 },
  s: { x: 0, y: 1 },
  arrowleft: { x: -1, y: 0 },
  a: { x: -1, y: 0 },
  arrowright: { x: 1, y: 0 },
  d: { x: 1, y: 0 },
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const length = ({ x, y }: Vec2) => Math.hypot(x, y);

const normalize = (vector: Vec2): Vec2 => {
  const len = length(vector);
  if (!len) return { x: 0, y: 0 };
  return { x: vector.x / len, y: vector.y / len };
};

const interpolate = (from: Vec2, to: Vec2, factor: number): Vec2 => ({
  x: from.x + (to.x - from.x) * factor,
  y: from.y + (to.y - from.y) * factor,
});

const generateCollectibles = (width: number, height: number): Collectible[] => {
  const count = 6;
  const margin = EDGE_PADDING + 30;
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    position: {
      x: margin + Math.random() * (width - margin * 2),
      y: margin + Math.random() * (height - margin * 2),
    },
    taken: false,
    spin: Math.random() * Math.PI * 2,
  }));
};

const drawStar = (
  ctx: CanvasRenderingContext2D,
  position: Vec2,
  radius: number,
  rotation: number,
  color: string,
) => {
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate(rotation);
  ctx.beginPath();
  const spikes = 5;
  const outerRadius = radius;
  const innerRadius = radius * 0.46;
  for (let i = 0; i < spikes * 2; i += 1) {
    const angle = (Math.PI / spikes) * i;
    const currentRadius = i % 2 === 0 ? outerRadius : innerRadius;
    ctx.lineTo(
      Math.cos(angle) * currentRadius,
      Math.sin(angle) * currentRadius,
    );
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = "rgba(255, 255, 255, 0.3)";
  ctx.shadowBlur = radius * 1.6;
  ctx.fill();
  ctx.restore();
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

const useGame = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastTimestamp = useRef<number | null>(null);
  const aksRef = useRef<Vec2>({ x: 0, y: 0 });
  const oliveRef = useRef<Vec2>({ x: 0, y: 0 });
  const aksDirectionRef = useRef<Vec2>({ x: 1, y: 0 });
  const oliveDirectionRef = useRef<Vec2>({ x: 1, y: 0 });
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const trailRef = useRef<Vec2[]>([]);
  const collectiblesRef = useRef<Collectible[]>([]);
  const collectedRef = useRef(0);
  const timeRef = useRef(0);
  const lastUiUpdate = useRef(0);
  const [uiState, setUiState] = useState<UiState>({
    time: 0,
    collected: 0,
    distance: 0,
    pace: 0,
  });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const setup = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth, clientHeight } = canvas;
      canvas.width = clientWidth * dpr;
      canvas.height = clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const initializePositions = () => {
      const { clientWidth: width, clientHeight: height } = canvas;
      aksRef.current = { x: width * 0.65, y: height * 0.55 };
      oliveRef.current = { x: width * 0.5, y: height * 0.6 };
      trailRef.current = [{ ...oliveRef.current }];
      collectiblesRef.current = generateCollectibles(width, height);
      collectedRef.current = 0;
      timeRef.current = 0;
      lastTimestamp.current = null;
      setReady(true);
    };

    setup();
    initializePositions();

    const resizeObserver = new ResizeObserver(() => {
      setup();
      initializePositions();
    });
    resizeObserver.observe(container);

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (KEY_DIRECTIONS[key]) {
        pressedKeysRef.current.add(key);
        event.preventDefault();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (KEY_DIRECTIONS[key]) {
        pressedKeysRef.current.delete(key);
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    let animationFrame: number;

    const updateUiState = (distance: number) => {
      const now = performance.now();
      if (now - lastUiUpdate.current < UI_INTERVAL) return;
      lastUiUpdate.current = now;
      setUiState({
        time: timeRef.current,
        collected: collectedRef.current,
        distance,
        pace:
          collectedRef.current === 0
            ? 0
            : timeRef.current / collectedRef.current,
      });
    };

    const drawScene = () => {
      const { clientWidth: width, clientHeight: height } = canvas;
      ctx.clearRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, 0, 0, height);
      gradient.addColorStop(0, "rgba(21, 18, 48, 1)");
      gradient.addColorStop(1, "rgba(6, 12, 24, 1)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      const walkway = {
        x: EDGE_PADDING,
        y: EDGE_PADDING,
        width: width - EDGE_PADDING * 2,
        height: height - EDGE_PADDING * 2,
      };
      drawRoundedRect(ctx, walkway.x, walkway.y, walkway.width, walkway.height, 36);
      ctx.fillStyle = "rgba(21, 26, 54, 0.9)";
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = "rgba(111, 140, 255, 0.2)";
      ctx.stroke();

      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.2;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(180, 190, 255, 0.25)";

      const gridSize = 64;
      for (let x = walkway.x; x <= walkway.x + walkway.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, walkway.y);
        ctx.lineTo(x, walkway.y + walkway.height);
        ctx.stroke();
      }
      for (let y = walkway.y; y <= walkway.y + walkway.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(walkway.x, y);
        ctx.lineTo(walkway.x + walkway.width, y);
        ctx.stroke();
      }
      ctx.restore();

      const trail = trailRef.current;
      for (let i = 0; i < trail.length; i += 1) {
        const point = trail[i];
        const alpha = i / trail.length;
        ctx.beginPath();
        ctx.fillStyle = `rgba(148, 197, 255, ${alpha * 0.35})`;
        ctx.arc(point.x, point.y, 10 * alpha, 0, Math.PI * 2);
        ctx.fill();
      }

      collectiblesRef.current.forEach((collectible) => {
        if (collectible.taken) return;
        drawStar(
          ctx,
          collectible.position,
          14,
          collectible.spin,
          "rgba(255, 244, 132, 0.95)",
        );
      });

      const drawCharacter = (
        position: Vec2,
        direction: Vec2,
        palette: { base: string; accent: string; outline: string },
        label: string,
      ) => {
        ctx.save();
        ctx.translate(position.x, position.y);

        ctx.fillStyle = palette.accent;
        ctx.shadowBlur = 20;
        ctx.shadowColor = palette.accent;
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.ellipse(0, 18, 26, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        const facing = Math.atan2(direction.y, direction.x);
        ctx.rotate(facing);

        ctx.fillStyle = palette.base;
        ctx.strokeStyle = palette.outline;
        ctx.lineWidth = 3;

        ctx.beginPath();
        ctx.ellipse(0, -20, 24, 18, 0, Math.PI * 0.2, Math.PI * 1.8);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = palette.base;
        ctx.beginPath();
        ctx.arc(0, -6, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(-6, -8, 4, 0, Math.PI * 2);
        ctx.arc(6, -8, 4, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#1c1f4b";
        ctx.beginPath();
        ctx.arc(-5, -8, 2, 0, Math.PI * 2);
        ctx.arc(5, -8, 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = palette.accent;
        ctx.beginPath();
        ctx.arc(0, -16, 18, Math.PI * 1.1, Math.PI * 1.9);
        ctx.fill();

        ctx.restore();

        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.font = "600 16px 'Geist', system-ui";
        ctx.textAlign = "center";
        ctx.fillText(label, position.x, position.y - 48);
        ctx.restore();
      };

      drawCharacter(oliveRef.current, oliveDirectionRef.current, {
        base: "rgba(76, 230, 172, 0.9)",
        accent: "rgba(48, 190, 138, 0.9)",
        outline: "rgba(22, 92, 72, 0.8)",
      }, "Olive");

      drawCharacter(aksRef.current, aksDirectionRef.current, {
        base: "rgba(255, 149, 189, 0.95)",
        accent: "rgba(255, 102, 150, 0.9)",
        outline: "rgba(145, 55, 92, 0.85)",
      }, "Aks");
    };

    const step = (timestamp: number) => {
      if (lastTimestamp.current === null) {
        lastTimestamp.current = timestamp;
      }
      const delta = (timestamp - lastTimestamp.current) / 1000;
      lastTimestamp.current = timestamp;

      const aks = aksRef.current;
      const olive = oliveRef.current;
      const { clientWidth: width, clientHeight: height } = canvas;

      let inputVector: Vec2 = { x: 0, y: 0 };
      pressedKeysRef.current.forEach((key) => {
        const direction = KEY_DIRECTIONS[key];
        if (direction) {
          inputVector = {
            x: inputVector.x + direction.x,
            y: inputVector.y + direction.y,
          };
        }
      });

      const normalizedInput = normalize(inputVector);
      if (normalizedInput.x || normalizedInput.y) {
        aksRef.current = {
          x: clamp(
            aks.x + normalizedInput.x * SPEED * delta,
            EDGE_PADDING,
            width - EDGE_PADDING,
          ),
          y: clamp(
            aks.y + normalizedInput.y * SPEED * delta,
            EDGE_PADDING,
            height - EDGE_PADDING,
          ),
        };
        aksDirectionRef.current = normalizedInput;
      }

      trailRef.current.push({ ...aksRef.current });
      if (trailRef.current.length > TRAIL_LIMIT) {
        trailRef.current.shift();
      }

      const targetIndex = Math.max(
        0,
        trailRef.current.length - 1 - FOLLOW_DELAY,
      );
      const followTarget = trailRef.current[targetIndex] ?? aksRef.current;
      const followVector = {
        x: followTarget.x - olive.x,
        y: followTarget.y - olive.y,
      };
      const followDistance = length(followVector);
      const stepFactor = Math.min(1, delta * 6);
      const nextOlive = interpolate(olive, followTarget, stepFactor);

      oliveRef.current = {
        x: clamp(nextOlive.x, EDGE_PADDING, width - EDGE_PADDING),
        y: clamp(nextOlive.y, EDGE_PADDING, height - EDGE_PADDING),
      };

      if (followDistance > 1) {
        oliveDirectionRef.current = normalize(followVector);
      }

      collectiblesRef.current.forEach((collectible) => {
        if (collectible.taken) return;
        const distanceToAks = length({
          x: collectible.position.x - aksRef.current.x,
          y: collectible.position.y - aksRef.current.y,
        });
        if (distanceToAks < 30) {
          collectible.taken = true;
          collectedRef.current += 1;
        }
        collectible.spin += delta * 1.6;
      });

      if (collectiblesRef.current.every((collectible) => collectible.taken)) {
        collectiblesRef.current = generateCollectibles(width, height);
      }

      timeRef.current += delta;
      const pairDistance = length({
        x: aksRef.current.x - oliveRef.current.x,
        y: aksRef.current.y - oliveRef.current.y,
      });

      updateUiState(pairDistance);
      drawScene();
      animationFrame = requestAnimationFrame(step);
    };

    animationFrame = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  return { canvasRef, containerRef, uiState, ready };
};

const formatNumber = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits) : "--";

const Game = () => {
  const { canvasRef, containerRef, uiState, ready } = useGame();

  const metrics = useMemo(
    () => [
      {
        label: "Following Time",
        value: `${formatNumber(uiState.time, 1)}s`,
        description: "How long Aks has been guiding Olive.",
      },
      {
        label: "Treasures",
        value: uiState.collected.toString(),
        description: "Stars the duo collected together.",
      },
      {
        label: "Gap Distance",
        value: `${formatNumber(uiState.distance, 0)}px`,
        description: "Current space between Olive and Aks.",
      },
      {
        label: "Avg Pace",
        value:
          uiState.pace === 0
            ? "--"
            : `${formatNumber(uiState.pace, 1)}s / star`,
        description: "How quickly the pair finds new stars.",
      },
    ],
    [uiState],
  );

  return (
    <section className="flex flex-col gap-8 text-white">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold sm:text-3xl">
          Olive follows Aks across the aurora path
        </h2>
        <p className="text-sm text-white/70 sm:text-base">
          Use the arrow keys or WASD to guide Aks. Olive will dash behind her,
          collecting shimmering stars together. Keep them close so they stay in
          sync.
        </p>
      </div>
      <div
        ref={containerRef}
        className="relative flex w-full flex-col gap-6 rounded-3xl border border-white/15 bg-white/5 p-6 backdrop-blur-xl sm:p-8"
      >
        <canvas
          ref={canvasRef}
          className="h-[60vh] w-full max-h-[560px] rounded-2xl bg-transparent"
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-lg shadow-black/20"
            >
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                {metric.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {metric.value}
              </p>
              <p className="mt-1 text-xs text-white/60">{metric.description}</p>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-gradient-to-r from-white/10 to-transparent p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">
              {ready ? "The chase is on!" : "Loading the aurora path..."}
            </p>
            <p className="text-xs text-white/60">
              Guide Aks smoothly so Olive keeps up. Collect every star to refresh
              the sky.
            </p>
          </div>
          <div className="flex gap-2 text-xs text-white/70">
            <div className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-pink-300" />
              <span>Aks</span>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              <span>Olive</span>
            </div>
            <div className="flex items-center gap-1 rounded-full border border-white/15 px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-yellow-200" />
              <span>Star</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-6 py-12 sm:px-10">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-12">
        <header className="flex flex-col gap-4 text-white">
          <p className="text-xs uppercase tracking-[0.4em] text-white/40">
            Aurora chase
          </p>
          <h1 className="text-3xl font-semibold sm:text-5xl">
            Guide Aks while Olive follows close behind
          </h1>
          <p className="max-w-2xl text-sm text-white/65 sm:text-base">
            Navigate the glowing walkway, scoop up the stars, and keep Olive on
            Aks&apos; heels. The closer they are, the faster they move in rhythm.
          </p>
        </header>
        <Game />
      </main>
    </div>
  );
}
