export function MethodologyDisclosure(): JSX.Element {
  return (
    <section className="eldar-panel rounded-2xl p-3">
      <p className="text-[10px] uppercase tracking-[0.12em] text-white/60">Methodology Disclosure</p>
      <div className="mt-2 grid gap-2 text-[11px] text-white/75 md:grid-cols-2">
        <div>
          <p className="font-semibold text-white/85">1) What it measures</p>
          <p>Portfolio quality using six peer-relative pillars and a 0–10 composite.</p>
        </div>
        <div>
          <p className="font-semibold text-white/85">2) Pillar formulas</p>
          <p>Return, Risk, Drawdown, Diversification, Implementability, and ELDAR Alpha Tilt are scored 0–100 and weighted.</p>
        </div>
        <div>
          <p className="font-semibold text-white/85">3) Peer groups</p>
          <p>Peer group is auto-classified from holdings concentration and sector structure.</p>
        </div>
        <div>
          <p className="font-semibold text-white/85">4) Gating rules</p>
          <p>Strong ratings are capped when months of history are below 12 or data completeness is below 0.65.</p>
        </div>
        <div>
          <p className="font-semibold text-white/85">5) Data limits</p>
          <p>Missing pillars are removed from the denominator; low ELDAR coverage reduces ELDAR Tilt weight proportionally.</p>
        </div>
        <div>
          <p className="font-semibold text-white/85">6) Academic references</p>
          <p>Sharpe (1966), Jensen (1968), Fama-French (1993), Carhart (1997).</p>
        </div>
        <div className="md:col-span-2">
          <p className="font-semibold text-white/85">7) Important note</p>
          <p>This rating is not a forecast of future returns.</p>
        </div>
      </div>
    </section>
  );
}
