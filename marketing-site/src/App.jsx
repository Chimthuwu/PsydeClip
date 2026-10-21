import React from 'react';
import { motion } from 'framer-motion';
import { Download, Radio, Music, Keyboard, History, Volume2, Scissors } from 'lucide-react';
import VisualizerStage from './components/VisualizerStage.jsx';

const REPO = 'https://github.com/Chimthuwu/PsydeClip';
const RELEASE = REPO + '/releases/latest';
/** Stable across versions: the release carries a versionless copy of the installer. */
const SETUP = REPO + '/releases/latest/download/PsydeClip-Windows-Setup.exe';
const VERSION = '4.3.1';
/** Demo video. The no-cookie domain is YouTube's privacy-enhanced embed. */
const VIDEO_ID = 'bFeG41zjfh4';

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

/**
 * lucide dropped its brand icons, so the GitHub mark is inline rather than a
 * second icon dependency for one glyph.
 */
function GithubMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/** Mirrors VISUALIZER_LABELS in src/shared/types.ts. */
const MODES = ['Oscilloscope', 'Spectrum', 'Spectrogram', 'History', 'MIDI'];


const ACCENTS = {
  magenta: { ring: 'hover:border-neon-magenta/50', bg: 'bg-neon-magenta/10', fg: 'text-neon-magenta' },
  cyan: { ring: 'hover:border-neon-cyan/50', bg: 'bg-neon-cyan/10', fg: 'text-neon-cyan' },
  purple: { ring: 'hover:border-neon-purple/50', bg: 'bg-neon-purple/10', fg: 'text-neon-purple' },
};

function Nav() {
  return (
    <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-[#05050A]/70 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-neon-magenta animate-pulse-dot" />
          <span className="font-extrabold text-xl tracking-tight">psydeclip</span>
        </a>
        <div className="flex items-center gap-6">
          <a href="#visualizers" className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors">
            Visualizers
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <GithubMark size={16} /> GitHub
          </a>
          <a
            href={SETUP}
            className="hidden sm:flex text-sm px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:-translate-y-0.5 transition-all"
          >
            Download
          </a>
        </div>
      </div>
    </nav>
  );
}


function Hero() {
  return (
    <section id="top" className="relative pt-32 pb-20 lg:pt-44 lg:pb-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
          <motion.div
            variants={fadeIn}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-neon-cyan/10 border border-neon-cyan/30 text-xs font-semibold text-neon-cyan mb-6"
          >
            <span className="w-2 h-2 rounded-full bg-neon-cyan" />
            v{VERSION} · Windows · work in progress
          </motion.div>

          <motion.h1
            variants={fadeIn}
            className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 leading-[1.1]"
          >
            Never miss a moment of{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-br from-neon-cyan to-neon-magenta">
              audio.
            </span>
          </motion.h1>

          <motion.p variants={fadeIn} className="text-lg md:text-xl text-gray-400 max-w-3xl mx-auto mb-10">
            A rolling-sampler system audio recorder for Windows. It is always quietly recording into memory — press{' '}
            <strong className="text-white">Save</strong> to write the last 5 minutes, or however long you buffered, to
            disk.
          </motion.p>

          <motion.div variants={fadeIn} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={SETUP}
              className="px-8 py-4 rounded-full bg-gradient-to-br from-neon-magenta to-neon-purple text-white font-bold shadow-[0_4px_20px_rgba(255,0,255,0.3)] hover:shadow-[0_6px_30px_rgba(255,0,255,0.5)] hover:-translate-y-0.5 transition-all flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              <Download size={20} /> Download for Windows
            </a>
            <a
              href="#visualizers"
              className="px-8 py-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 hover:-translate-y-0.5 transition-all flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              See the views
            </a>
          </motion.div>

          <motion.p variants={fadeIn} className="mt-5 text-xs text-gray-500 max-w-xl mx-auto">
            v{VERSION} · 83 MB installer, ~330 MB installed · Windows 10 or later. The installer is unsigned, so
            SmartScreen will warn on first run.
          </motion.p>
        </motion.div>
      </div>
    </section>
  );
}

/**
 * The visualizer demo. The stage is its own component — it owns a canvas and a
 * rAF loop — while the section wrapper lives here with the others so it picks
 * up the same heading rhythm and reveal animation.
 */
function Visualizers() {
  return (
    <section id="visualizers" className="py-16 relative border-t border-white/5 bg-white/[0.01]">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center mb-8"
        >
          <h2 className="text-xl md:text-2xl font-bold mb-2">Five views</h2>
          <p className="text-sm text-gray-400 max-w-xl mx-auto">
            Highlight a stretch of History, the spectrogram or the MIDI notes, and drag it straight onto your
            desktop as a WAV or a .mid.
          </p>
        </motion.div>

        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeIn}>
          <VisualizerStage />
        </motion.div>
      </div>
    </section>
  );
}

/** Real captures of the app, not mockups. */
const SHOTS = [
  { src: 'shots-user/bloodred-grid.png', alt: 'PsydeClip in the Blood Red theme with the grid view', w: 1074, h: 553 },
  { src: 'shots-user/kawaii-grid.png', alt: 'PsydeClip in the Kawaii theme with the grid view', w: 836, h: 410 },
  { src: 'shots-user/modern-midi.png', alt: 'PsydeClip MIDI view in the Modern theme', w: 1074, h: 575 },
  { src: 'shots-user/red-midi.png', alt: 'PsydeClip MIDI view in the Blood Red theme', w: 1074, h: 575 },
];

function Screenshots() {
  return (
    <section id="screenshots" className="py-20 border-t border-white/5">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeIn}>
          <img
            src="shots-user/hero-modern.png"
            alt="The PsydeClip main window"
            width={1254}
            height={681}
            loading="lazy"
            className="w-full rounded-2xl border border-white/10 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]"
          />
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            {SHOTS.map((s) => (
              <img
                key={s.src}
                src={s.src}
                alt={s.alt}
                width={s.w}
                height={s.h}
                loading="lazy"
                className="w-full rounded-xl border border-white/10"
              />
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function TechStack() {
  const stack = ['Electron 30', 'React 18', 'TypeScript 5', 'Vite 5', 'NAudio WASAPI', 'WebM / Opus', 'Basic Pitch'];
  return (
    <section className="py-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h3 className="text-sm uppercase tracking-[0.2em] text-gray-500 mb-8">Built with</h3>
        <div className="flex flex-wrap justify-center gap-3 max-w-3xl mx-auto">
          {stack.map((tech) => (
            <span
              key={tech}
              className="px-5 py-2 rounded-full border border-white/10 bg-white/[0.03] font-mono text-[13px] text-gray-300"
            >
              {tech}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The demo video, embedded at 16:9 and loaded only when the section is near the viewport. */
function Video() {
  return (
    <section id="video" className="py-24 border-t border-white/5">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center mb-12"
        >
          <h2 className="text-3xl md:text-5xl font-extrabold mb-4">
            See it{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-br from-neon-cyan to-neon-magenta">
              in action.
            </span>
          </h2>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 bg-black shadow-[0_0_40px_rgba(0,255,255,0.08)]"
        >
          <iframe
            className="absolute inset-0 w-full h-full"
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`}
            title="PsydeClip demo video"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-12 border-t border-white/10 text-center text-gray-500 text-sm">
      <div className="max-w-7xl mx-auto px-4">
        <p className="mb-2">Built in Windsor, Ontario · Windows 10 or later.</p>
        <p className="mb-4 text-xs max-w-2xl mx-auto">
          ~330 MB installed. The rolling buffer lives in RAM, so disk only fills as fast as you save — about 0.7 MB a
          minute at the default 96 kbps Opus, ~11 MB a minute for WAV.
        </p>
        <p>MIT License · Copyright © 2026 Chimthuwu</p>
        <div className="flex justify-center gap-6 mt-6">
          <a href={REPO} className="text-neon-cyan hover:underline">
            GitHub
          </a>
          <a href={`${REPO}/issues`} className="text-neon-cyan hover:underline">
            Issues
          </a>
          <a href={RELEASE} className="text-neon-cyan hover:underline">
            Releases
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="relative min-h-screen bg-[#05050A] text-white font-sans overflow-x-hidden">
      <div className="glow-orb glow-1" aria-hidden="true" />
      <div className="glow-orb glow-2" aria-hidden="true" />
      <Nav />
      <Hero />
      <Video />
      <Visualizers />
      <Screenshots />
      <TechStack />
      <Footer />
    </div>
  );
}
