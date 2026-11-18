import React from 'react';

interface SplashScreenProps {
  isExiting?: boolean;
}

const ORBIT_PARTICLES_INNER = [
  { angle: 0, size: 5, color: '#22d3ee', glow: 'rgba(34,211,238,0.9)' },
  { angle: 72, size: 4, color: '#a855f7', glow: 'rgba(168,85,247,0.9)' },
  { angle: 144, size: 6, color: '#3b82f6', glow: 'rgba(59,130,246,0.9)' },
  { angle: 216, size: 4, color: '#c084fc', glow: 'rgba(192,132,252,0.85)' },
  { angle: 288, size: 5, color: '#38bdf8', glow: 'rgba(56,189,248,0.9)' },
];

const ORBIT_PARTICLES_OUTER = [
  { angle: 30, size: 4, color: '#a855f7', glow: 'rgba(168,85,247,0.85)' },
  { angle: 105, size: 5, color: '#22d3ee', glow: 'rgba(34,211,238,0.85)' },
  { angle: 195, size: 3.5, color: '#60a5fa', glow: 'rgba(96,165,250,0.85)' },
  { angle: 270, size: 4.5, color: '#d946ef', glow: 'rgba(217,70,239,0.85)' },
  { angle: 330, size: 3.5, color: '#22d3ee', glow: 'rgba(34,211,238,0.8)' },
];

export const SplashScreen: React.FC<SplashScreenProps> = ({ isExiting = false }) => {
  return (
    <div
      aria-label="Launching LiveConnect"
      className={`fixed inset-0 z-[100] min-h-screen-safe w-full flex flex-col items-center justify-center overflow-hidden select-none transition-all duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] ${
        isExiting
          ? 'opacity-0 scale-[1.045] pointer-events-none'
          : 'opacity-100 scale-100'
      }`}
      style={{
        background:
          'radial-gradient(circle at 50% 46%, #070b1c 0%, #03050c 52%, #000000 100%)',
      }}
    >
      {/* Final Phase (2400-3000ms) Ambient Neon Glow Backdrop */}
      <div
        className="lc-launch-final-bloom absolute w-[340px] h-[340px] sm:w-[420px] sm:h-[420px] rounded-full blur-3xl pointer-events-none"
        style={{
          background:
            'radial-gradient(circle, rgba(168,85,247,0.34) 0%, rgba(59,130,246,0.24) 38%, rgba(34,211,238,0.14) 62%, transparent 78%)',
        }}
      />

      {/* Central Cinematic Stage */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        <div className="relative flex items-center justify-center w-64 h-64 sm:w-72 sm:h-72">
          {/* Phase 1 (0-500ms): Initial Purple & Cyan Point Light + Optical Flare */}
          <div className="lc-launch-seed absolute w-24 h-24 rounded-full pointer-events-none flex items-center justify-center">
            <div
              className="w-full h-full rounded-full blur-md"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(34,211,238,0.85) 24%, rgba(168,85,247,0.68) 54%, transparent 76%)',
              }}
            />
          </div>
          <div className="lc-launch-flare absolute w-28 h-28 pointer-events-none flex items-center justify-center">
            <div
              className="absolute w-full h-[2px] rounded-full"
              style={{
                background:
                  'linear-gradient(90deg, transparent 0%, rgba(34,211,238,0.9) 45%, #ffffff 50%, rgba(168,85,247,0.9) 55%, transparent 100%)',
              }}
            />
            <div
              className="absolute h-full w-[2px] rounded-full"
              style={{
                background:
                  'linear-gradient(180deg, transparent 0%, rgba(168,85,247,0.9) 45%, #ffffff 50%, rgba(34,211,238,0.9) 55%, transparent 100%)',
              }}
            />
          </div>

          {/* Phase 2 (500-1200ms): Expanding Shockwave Pulse */}
          <div
            className="lc-launch-shockwave absolute w-52 h-52 sm:w-56 sm:h-56 rounded-full border border-cyan-300/60 pointer-events-none"
            style={{
              boxShadow: '0 0 24px rgba(34,211,238,0.35), inset 0 0 20px rgba(168,85,247,0.28)',
            }}
          />

          {/* Phase 2 (500-1200ms): Circular Neon Energy Ring */}
          <div className="lc-launch-ring-wrap absolute w-52 h-52 sm:w-56 sm:h-56 flex items-center justify-center pointer-events-none">
            {/* Soft Glow Halo Ring */}
            <div
              className="lc-launch-ring-spin absolute inset-0 rounded-full blur-md opacity-75"
              style={{
                background:
                  'conic-gradient(from 0deg, rgba(192,38,211,0.85), rgba(99,102,241,0.55), rgba(34,211,238,0.95), rgba(59,130,246,0.5), rgba(168,85,247,0.9), rgba(192,38,211,0.85))',
                WebkitMaskImage:
                  'radial-gradient(circle, transparent 64%, black 67%, black 72%, transparent 76%)',
                maskImage:
                  'radial-gradient(circle, transparent 64%, black 67%, black 72%, transparent 76%)',
              }}
            />
            {/* Sharp Razor Energy Ring */}
            <div
              className="lc-launch-ring-spin absolute inset-0 rounded-full"
              style={{
                background:
                  'conic-gradient(from 0deg, #d946ef 0deg, #8b5cf6 75deg, #3b82f6 150deg, #22d3ee 225deg, #6366f1 300deg, #d946ef 360deg)',
                WebkitMaskImage:
                  'radial-gradient(circle, transparent 66.5%, black 68%, black 70.2%, transparent 71.8%)',
                maskImage:
                  'radial-gradient(circle, transparent 66.5%, black 68%, black 70.2%, transparent 71.8%)',
              }}
            />
          </div>

          {/* Phase 2 (500ms+): Smooth Rotating Blue & Purple Light Particles */}
          <div className="lc-launch-orbit-in absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="lc-launch-orbit-cw absolute w-56 h-56 sm:w-64 sm:h-64">
              {ORBIT_PARTICLES_INNER.map((p, idx) => (
                <div
                  key={`inner-${idx}`}
                  className="absolute inset-0"
                  style={{ transform: `rotate(${p.angle}deg)` }}
                >
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full"
                    style={{
                      width: `${p.size}px`,
                      height: `${p.size}px`,
                      backgroundColor: p.color,
                      boxShadow: `0 0 12px 2px ${p.glow}`,
                    }}
                  />
                </div>
              ))}
            </div>

            <div className="lc-launch-orbit-ccw absolute w-64 h-64 sm:w-72 sm:h-72 opacity-85">
              {ORBIT_PARTICLES_OUTER.map((p, idx) => (
                <div
                  key={`outer-${idx}`}
                  className="absolute inset-0"
                  style={{ transform: `rotate(${p.angle}deg)` }}
                >
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 rounded-full"
                    style={{
                      width: `${p.size}px`,
                      height: `${p.size}px`,
                      backgroundColor: p.color,
                      boxShadow: `0 0 10px 2px ${p.glow}`,
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Phase 3 (1200-2000ms): Neon Backlight + 3D Scale Reveal of Actual LiveConnect Logo + Light Sweep */}
          <div
            className="lc-launch-logo-glow absolute w-40 h-40 sm:w-44 sm:h-44 rounded-full blur-2xl pointer-events-none"
            style={{
              background:
                'radial-gradient(circle, rgba(168,85,247,0.45) 0%, rgba(34,211,238,0.35) 55%, transparent 78%)',
            }}
          />

          <div
            className="lc-launch-logo relative w-32 h-32 sm:w-36 sm:h-36 rounded-[28px] overflow-hidden flex items-center justify-center"
            style={{
              WebkitMaskImage:
                'radial-gradient(circle at center, #000 66%, rgba(0,0,0,0.92) 79%, transparent 98%)',
              maskImage:
                'radial-gradient(circle at center, #000 66%, rgba(0,0,0,0.92) 79%, transparent 98%)',
              filter: 'drop-shadow(0 0 22px rgba(59,130,246,0.38))',
            }}
          >
            <img
              src="/assets/aistudio/Neon_LiveConnect_App_Icon_b1b5dd76.png"
              alt="LiveConnect"
              className="w-full h-full object-contain pointer-events-none"
            />
            {/* Subtle Light Sweep Across Logo (1550-2230ms) */}
            <div
              className="lc-launch-sheen absolute inset-y-0 w-1/2 pointer-events-none"
              style={{
                background:
                  'linear-gradient(105deg, transparent 15%, rgba(255,255,255,0.08) 38%, rgba(165,243,252,0.38) 50%, rgba(192,132,252,0.22) 60%, transparent 82%)',
              }}
            />
          </div>
        </div>

        {/* Phase 4 (2000-2400ms): LiveConnect Wordmark Reveal Below the Logo */}
        <div className="lc-launch-wordmark flex flex-col items-center mt-2">
          <h1 className="text-[28px] sm:text-[34px] font-extrabold tracking-tight leading-none">
            <span className="text-white drop-shadow-[0_0_16px_rgba(255,255,255,0.28)]">
              Live
            </span>
            <span
              className="bg-clip-text text-transparent"
              style={{
                backgroundImage:
                  'linear-gradient(90deg, #e879f9 0%, #818cf8 48%, #22d3ee 100%)',
                filter: 'drop-shadow(0 0 14px rgba(56,189,248,0.35))',
              }}
            >
              Connect
            </span>
          </h1>
          <div
            className="lc-launch-horizon mt-2.5 h-[2px] w-28 sm:w-32 rounded-full"
            style={{
              background:
                'linear-gradient(90deg, transparent 0%, #c084fc 28%, #38bdf8 52%, #22d3ee 74%, transparent 100%)',
              boxShadow: '0 0 12px rgba(56,189,248,0.65)',
            }}
          />
        </div>
      </div>
    </div>
  );
};
