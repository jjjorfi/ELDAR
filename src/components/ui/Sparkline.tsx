"use client";

import { useEffect, useRef } from "react";
import { CategoryScale, Chart, type ChartDataset, Filler, LineElement, LinearScale, PointElement } from "chart.js";

Chart.register(LineElement, PointElement, LinearScale, CategoryScale, Filler);

export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showArea?: boolean;
  className?: string;
}

function getColor(data: number[], override?: string): string {
  if (override) return override;
  if (data.length === 0) return "#6b7280";

  const trend = data[data.length - 1] - data[0];
  if (trend > 0) return "#10b981";
  if (trend < 0) return "#ef4444";
  return "#6b7280";
}

function createAreaGradient(ctx: CanvasRenderingContext2D, height: number, lineColor: string): CanvasGradient {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `${lineColor}30`);
  gradient.addColorStop(1, `${lineColor}00`);
  return gradient;
}

/**
 * Minimal sparkline chart for compact market tables and ticker rows.
 */
export function Sparkline({
  data,
  width = 80,
  height = 32,
  color,
  showArea = true,
  className
}: SparklineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<"line"> | null>(null);

  const lineColor = getColor(data, color);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    chartRef.current?.destroy();
    chartRef.current = null;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dataset: ChartDataset<"line", number[]> = {
      data,
      borderColor: lineColor,
      borderWidth: 1.5,
      fill: showArea,
      backgroundColor: showArea ? createAreaGradient(ctx, height, lineColor) : "transparent",
      pointRadius: 0,
      pointHoverRadius: 0,
      tension: 0.3
    };

    chartRef.current = new Chart<"line", number[], number>(ctx, {
      type: "line",
      data: {
        labels: data.map((_, index) => index),
        datasets: [dataset]
      },
      options: {
        responsive: false,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        },
        scales: {
          x: { display: false },
          y: { display: false }
        },
        elements: {
          line: { borderCapStyle: "round" }
        }
      }
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [data, height, lineColor, showArea]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const dataset = chart.data.datasets[0];
    dataset.data = data;
    dataset.borderColor = lineColor;

    const ctx = chart.ctx;
    dataset.backgroundColor = showArea ? createAreaGradient(ctx, height, lineColor) : "transparent";
    chart.update("none");
  }, [data, height, lineColor, showArea]);

  return <canvas ref={canvasRef} width={width} height={height} className={className} style={{ display: "block" }} />;
}

export interface SparklineCellProps {
  data: number[];
  change?: number;
}

/**
 * Sparkline plus optional percent-change label for table cells.
 */
export function SparklineCell({ data, change }: SparklineCellProps) {
  const color = getColor(data);
  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;

  return (
    <div className="flex items-center gap-2">
      <Sparkline data={data} width={72} height={28} />
      {change !== undefined ? (
        <span
          className="text-xs font-mono tabular-nums"
          style={{ color: isPositive ? "#10b981" : isNegative ? "#ef4444" : "#6b7280" }}
        >
          {isPositive ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      ) : null}
    </div>
  );
}
