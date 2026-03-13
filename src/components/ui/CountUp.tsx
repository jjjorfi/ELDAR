"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type EasingFn = (t: number) => number;

const easings: Record<string, EasingFn> = {
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  linear: (t) => t
};

type Options = {
  duration?: number;
  decimals?: number;
  easing?: keyof typeof easings;
  prefix?: string;
  suffix?: string;
  separator?: string;
  startOnMount?: boolean;
};

export function useCountUp(target: number, options: Options = {}) {
  const {
    duration = 1200,
    decimals = 0,
    easing = "easeOut",
    prefix = "",
    suffix = "",
    separator = ",",
    startOnMount = true
  } = options;

  const [value, setValue] = useState(0);
  const [running, setRunning] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const fromRef = useRef(0);
  const valueRef = useRef(0);
  const prevTargetRef = useRef(target);

  const easeFn = easings[easing];

  const start = useCallback((from = 0) => {
    fromRef.current = from;
    startTimeRef.current = null;
    valueRef.current = from;
    setRunning(true);
  }, []);

  useEffect(() => {
    if (startOnMount) {
      start();
    }
  }, [startOnMount, start]);

  useEffect(() => {
    if (prevTargetRef.current !== target) {
      start(valueRef.current);
      prevTargetRef.current = target;
    }
  }, [target, start]);

  useEffect(() => {
    if (!running) return;

    const animate = (timestamp: number) => {
      if (startTimeRef.current === null) {
        startTimeRef.current = timestamp;
      }

      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeFn(progress);
      const current = fromRef.current + (target - fromRef.current) * eased;

      valueRef.current = current;
      setValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        valueRef.current = target;
        setValue(target);
        setRunning(false);
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [duration, easeFn, running, target]);

  const formatted = useMemo(() => {
    const rounded = value.toFixed(decimals);
    const [integerPart, decimalPart] = rounded.split(".");
    const withSeparator = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
    return prefix + (decimalPart !== undefined ? `${withSeparator}.${decimalPart}` : withSeparator) + suffix;
  }, [decimals, prefix, separator, suffix, value]);

  return { value, formatted, start };
}

type CountUpProps = {
  value: number;
  className?: string;
} & Options;

export function CountUp({ value, className, ...options }: CountUpProps): JSX.Element {
  const { formatted } = useCountUp(value, options);

  return (
    <span className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {formatted}
    </span>
  );
}
