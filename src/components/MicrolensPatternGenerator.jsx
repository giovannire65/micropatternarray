import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Download, Image as ImageIcon, Layers, RefreshCw, Info } from "lucide-react";

/**
 * Microlens Pattern Generator
 *
 * GitHub-ready single file React app.
 *
 * What it does:
 * - loads a source image
 * - optionally loads a grayscale depth map
 * - generates a simplified elemental image array for microlens testing
 * - previews the generated pattern
 * - exports the result as PNG
 *
 * Notes:
 * - this is a laboratory prototype for fast visual experiments
 * - it does not replace optical calibration based on real lens pitch, focal length, material thickness, or print scaling in mm
 */

type LoadedImage = HTMLImageElement | null;

type PatternOptions = {
  sourceImageData: ImageData;
  depthImageData: ImageData;
  width: number;
  height: number;
  viewsX: number;
  viewsY: number;
  cellW: number;
  cellH: number;
  maxShiftX: number;
  maxShiftY: number;
  depthInfluence: number;
  invertDepth: boolean;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function loadImageFromFile(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error(`Unable to load image: ${file.name}`));
    img.src = url;
  });
}

function drawCoverFit(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  targetW: number,
  targetH: number,
): void {
  const imageRatio = img.width / img.height;
  const targetRatio = targetW / targetH;

  let sx = 0;
  let sy = 0;
  let sw = img.width;
  let sh = img.height;

  if (imageRatio > targetRatio) {
    sw = img.height * targetRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / targetRatio;
    sy = (img.height - sh) / 2;
  }

  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetW, targetH);
}

function getScaledImageData(img: HTMLImageElement, width: number, height: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Unable to get 2D canvas context.");
  }

  drawCoverFit(ctx, img, width, height);
  return ctx.getImageData(0, 0, width, height);
}

function sampleNearest(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const xx = clamp(Math.round(x), 0, width - 1);
  const yy = clamp(Math.round(y), 0, height - 1);
  const index = (yy * width + xx) * 4;

  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
}

function generateDepthFromLuminance(imageData: ImageData): ImageData {
  const { data, width, height } = imageData;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < width * height; i += 1) {
    const index = i * 4;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const luminance = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

    output[index] = luminance;
    output[index + 1] = luminance;
    output[index + 2] = luminance;
    output[index + 3] = 255;
  }

  return new ImageData(output, width, height);
}

function generatePattern(options: PatternOptions): ImageData {
  const {
    sourceImageData,
    depthImageData,
    width,
    height,
    viewsX,
    viewsY,
    cellW,
    cellH,
    maxShiftX,
    maxShiftY,
    depthInfluence,
    invertDepth,
  } = options;

  const src = sourceImageData.data;
  const depth = depthImageData.data;
  const output = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cx = x % cellW;
      const cy = y % cellH;

      const vx = viewsX <= 1 ? 0 : (cx / Math.max(cellW - 1, 1)) * 2 - 1;
      const vy = viewsY <= 1 ? 0 : (cy / Math.max(cellH - 1, 1)) * 2 - 1;

      const depthIndex = (y * width + x) * 4;
      let depthValue = depth[depthIndex] / 255;
      if (invertDepth) depthValue = 1 - depthValue;

      const centeredDepth = (depthValue - 0.5) * 2;
      const shiftX = centeredDepth * maxShiftX * vx * depthInfluence;
      const shiftY = centeredDepth * maxShiftY * vy * depthInfluence;

      const [r, g, b, a] = sampleNearest(src, width, height, x - shiftX, y - shiftY);

      output[depthIndex] = r;
      output[depthIndex + 1] = g;
      output[depthIndex + 2] = b;
      output[depthIndex + 3] = a;
    }
  }

  return new ImageData(output, width, height);
}

function drawGridOverlay(ctx: CanvasRenderingContext2D, size: number): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.22)";

  const step = Math.max(4, size / 24);
  for (let x = 0; x <= size; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
    ctx.stroke();
  }

  for (let y = 0; y <= size; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
    ctx.stroke();
  }

  ctx.restore();
}

export default function MicrolensPatternGenerator(): JSX.Element {
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const patternCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sourceFileName, setSourceFileName] = useState<string>("No source image selected");
  const [depthFileName, setDepthFileName] = useState<string>("Auto-generated from luminance");
  const [sourceImg, setSourceImg] = useState<LoadedImage>(null);
  const [depthImg, setDepthImg] = useState<LoadedImage>(null);

  const [outputWidth, setOutputWidth] = useState<number>(1200);
  const [outputHeight, setOutputHeight] = useState<number>(1200);
  const [viewsX, setViewsX] = useState<number>(9);
  const [viewsY, setViewsY] = useState<number>(9);
  const [cellW, setCellW] = useState<number>(9);
  const [cellH, setCellH] = useState<number>(9);
  const [maxShiftX, setMaxShiftX] = useState<number>(12);
  const [maxShiftY, setMaxShiftY] = useState<number>(12);
  const [depthInfluence, setDepthInfluence] = useState<number>(1);
  const [invertDepth, setInvertDepth] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("Load a source image to begin.");

  const hasSource = Boolean(sourceImg);

  const parameterHint = useMemo(
    () => `Cell ${cellW}×${cellH}px • Views ${viewsX}×${viewsY} • Shift ${maxShiftX}/${maxShiftY}px`,
    [cellW, cellH, viewsX, viewsY, maxShiftX, maxShiftY],
  );

  async function handleSourceUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    const { img } = await loadImageFromFile(file);
    setSourceImg(img);
    setSourceFileName(file.name);
    setStatus("Source image loaded. You can now generate the pattern.");
  }

  async function handleDepthUpload(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;

    const { img } = await loadImageFromFile(file);
    setDepthImg(img);
    setDepthFileName(file.name);
    setStatus("Depth map loaded. The result should look more convincing.");
  }

  function resetAll(): void {
    setSourceImg(null);
    setDepthImg(null);
    setSourceFileName("No source image selected");
    setDepthFileName("Auto-generated from luminance");
    setStatus("Ready for a new test.");

    const previewCanvas = previewCanvasRef.current;
    const patternCanvas = patternCanvasRef.current;

    if (previewCanvas) {
      const ctx = previewCanvas.getContext("2d");
      ctx?.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }

    if (patternCanvas) {
      const ctx = patternCanvas.getContext("2d");
      ctx?.clearRect(0, 0, patternCanvas.width, patternCanvas.height);
    }
  }

  function generate(): void {
    if (!sourceImg || !patternCanvasRef.current || !previewCanvasRef.current) return;

    setIsGenerating(true);

    requestAnimationFrame(() => {
      try {
        const sourceData = getScaledImageData(sourceImg, outputWidth, outputHeight);
        const depthData = depthImg
          ? getScaledImageData(depthImg, outputWidth, outputHeight)
          : generateDepthFromLuminance(sourceData);

        const pattern = generatePattern({
          sourceImageData: sourceData,
          depthImageData: depthData,
          width: outputWidth,
          height: outputHeight,
          viewsX,
          viewsY,
          cellW,
          cellH,
          maxShiftX,
          maxShiftY,
          depthInfluence,
          invertDepth,
        });

        const patternCanvas = patternCanvasRef.current;
        const patternCtx = patternCanvas.getContext("2d", { willReadFrequently: true });
        if (!patternCtx) throw new Error("Unable to get pattern canvas context.");

        patternCanvas.width = outputWidth;
        patternCanvas.height = outputHeight;
        patternCtx.putImageData(pattern, 0, 0);

        const previewCanvas = previewCanvasRef.current;
        const previewCtx = previewCanvas.getContext("2d", { willReadFrequently: true });
        if (!previewCtx) throw new Error("Unable to get preview canvas context.");

        const previewSize = 520;
        previewCanvas.width = previewSize;
        previewCanvas.height = previewSize;
        previewCtx.clearRect(0, 0, previewSize, previewSize);
        previewCtx.drawImage(patternCanvas, 0, 0, previewSize, previewSize);
        drawGridOverlay(previewCtx, previewSize);

        setStatus("Pattern generated successfully. Download the PNG and test it under your microlens sheet.");
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        setStatus(`Error: ${message}`);
      } finally {
        setIsGenerating(false);
      }
    });
  }

  function downloadPNG(): void {
    const canvas = patternCanvasRef.current;
    if (!canvas) return;

    const link = document.createElement("a");
    link.download = `microlens-pattern-${outputWidth}x${outputHeight}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  useEffect(() => {
    if (!sourceImg || !previewCanvasRef.current) return;

    const canvas = previewCanvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = 520;
    canvas.width = size;
    canvas.height = size;
    drawCoverFit(ctx, sourceImg, size, size);
  }, [sourceImg]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 p-6">
      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card className="rounded-3xl border-zinc-800 bg-zinc-900 shadow-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-3 text-2xl">
                <Layers className="h-6 w-6" />
                Microlens Pattern Generator
              </CardTitle>
              <p className="text-sm text-zinc-400">
                GitHub-ready prototype for generating printable test patterns for transparent microlens sheets.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="source-image">Source image</Label>
                    <Input
                      id="source-image"
                      type="file"
                      accept="image/*"
                      onChange={handleSourceUpload}
                      className="border-zinc-800 bg-zinc-950"
                    />
                    <p className="text-xs text-zinc-400">{sourceFileName}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="depth-map">Depth map (optional)</Label>
                    <Input
                      id="depth-map"
                      type="file"
                      accept="image/*"
                      onChange={handleDepthUpload}
                      className="border-zinc-800 bg-zinc-950"
                    />
                    <p className="text-xs text-zinc-400">{depthFileName}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="output-width">Output width</Label>
                      <Input
                        id="output-width"
                        type="number"
                        value={outputWidth}
                        min={256}
                        max={4096}
                        step={1}
                        onChange={(e) => setOutputWidth(Number(e.target.value) || 1200)}
                        className="border-zinc-800 bg-zinc-950"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="output-height">Output height</Label>
                      <Input
                        id="output-height"
                        type="number"
                        value={outputHeight}
                        min={256}
                        max={4096}
                        step={1}
                        onChange={(e) => setOutputHeight(Number(e.target.value) || 1200)}
                        className="border-zinc-800 bg-zinc-950"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-3xl border border-zinc-800 bg-black/40 p-4">
                  <canvas
                    ref={previewCanvasRef}
                    className="aspect-square w-full rounded-2xl border border-zinc-800 bg-zinc-950"
                  />
                  <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                    <ImageIcon className="h-4 w-4" />
                    Source preview or generated pattern preview
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-zinc-800 bg-zinc-900 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-xl">Pattern settings</CardTitle>
              <p className="text-sm text-zinc-400">{parameterHint}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <div>
                    <Label>Horizontal views: {viewsX}</Label>
                    <Slider value={[viewsX]} min={1} max={17} step={1} onValueChange={(v) => setViewsX(v[0])} className="mt-2" />
                  </div>
                  <div>
                    <Label>Vertical views: {viewsY}</Label>
                    <Slider value={[viewsY]} min={1} max={17} step={1} onValueChange={(v) => setViewsY(v[0])} className="mt-2" />
                  </div>
                  <div>
                    <Label>Cell width: {cellW}px</Label>
                    <Slider value={[cellW]} min={2} max={24} step={1} onValueChange={(v) => setCellW(v[0])} className="mt-2" />
                  </div>
                  <div>
                    <Label>Cell height: {cellH}px</Label>
                    <Slider value={[cellH]} min={2} max={24} step={1} onValueChange={(v) => setCellH(v[0])} className="mt-2" />
                  </div>
                </div>

                <div className="space-y-4">
                  <div>
                    <Label>Maximum X shift: {maxShiftX}px</Label>
                    <Slider value={[maxShiftX]} min={0} max={40} step={1} onValueChange={(v) => setMaxShiftX(v[0])} className="mt-2" />
                  </div>
                  <div>
                    <Label>Maximum Y shift: {maxShiftY}px</Label>
                    <Slider value={[maxShiftY]} min={0} max={40} step={1} onValueChange={(v) => setMaxShiftY(v[0])} className="mt-2" />
                  </div>
                  <div>
                    <Label>Depth influence: {depthInfluence.toFixed(2)}</Label>
                    <Slider value={[depthInfluence]} min={0} max={2} step={0.05} onValueChange={(v) => setDepthInfluence(v[0])} className="mt-2" />
                  </div>
                  <label className="flex items-center gap-3 pt-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={invertDepth}
                      onChange={(e) => setInvertDepth(e.target.checked)}
                      className="rounded"
                    />
                    Invert depth map
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 pt-2">
                <Button onClick={generate} disabled={!hasSource || isGenerating} className="rounded-2xl">
                  {isGenerating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />}
                  Generate pattern
                </Button>
                <Button
                  variant="secondary"
                  onClick={downloadPNG}
                  disabled={!hasSource}
                  className="rounded-2xl bg-zinc-100 text-zinc-900 hover:bg-white"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download PNG
                </Button>
                <Button
                  variant="outline"
                  onClick={resetAll}
                  className="rounded-2xl border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-800"
                >
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="rounded-3xl border-zinc-800 bg-zinc-900 shadow-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Info className="h-5 w-5" />
                Quick guide
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-zinc-300">
              <p>1. Load a source image with clear foreground and background separation.</p>
              <p>2. Load a grayscale depth map for better results. If omitted, a luminance-based fallback will be used.</p>
              <p>3. Adjust cell size and shift values, then generate the pattern.</p>
              <p>4. Download the PNG, print it, and test it under your microlens sheet.</p>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-zinc-800 bg-zinc-900 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-xl">Technical note</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-6 text-zinc-300">
              <p>
                This app generates a simplified elemental image array. For precision work, you should calibrate the output using real lens pitch, focal length, optical thickness, viewing distance, and print scale in millimeters.
              </p>
              <p>
                Best first tests: portraits, flowers, isolated objects, and layered decorative patterns. Very crowded scenes tend to turn into optical soup.
              </p>
              <p className="text-zinc-400">Status: {status}</p>
            </CardContent>
          </Card>

          <Card className="rounded-3xl border-zinc-800 bg-zinc-900 shadow-2xl">
            <CardHeader>
              <CardTitle className="text-xl">Pattern output</CardTitle>
            </CardHeader>
            <CardContent>
              <canvas
                ref={patternCanvasRef}
                className="aspect-square w-full rounded-2xl border border-zinc-800 bg-zinc-950"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
