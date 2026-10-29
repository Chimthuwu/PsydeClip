import React from 'react';
import { motion } from 'framer-motion';
import { Download, Radio, Music, History, Volume2, Scissors, Palette } from 'lucide-react';

const REPO = 'https://github.com/Chimthuwu/PsydeClip';
const RELEASE = REPO + '/releases/latest';
/** Stable across versions: the release carries a versionless copy of the installer. */
const SETUP = REPO + '/releases/latest/download/PsydeClip-Windows-Setup.exe';
const VERSION = '4.4.0';
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

/** A section kicker: small mono label with a signal-coloured tick, used in
 *  place of gradient-clip headline text — one considered accent move instead
 *  of colour everywhere. */
function Kicker({ children }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      <span className="w-1.5 h-1.5 bg-signal-teal" aria-hidden="true" />
      <span className="font-mono text-xs uppercase tracking-[0.25em] text-white/50">{children}</span>
    </div>
  );
}

/** Wraps a screenshot in the app's own title-bar language (dot + lowercase
 *  mono wordmark) — real captures of the app, framed to look like the app,
 *  rather than a bare bordered <img>. */
function AppFrame({ title = 'psydeclip', live, children, className = '' }) {
  return (
    <div className={`rounded-xl overflow-hidden border border-white/10 bg-ink-900 ${className}`}>
      <div className="flex items-center gap-2.5 h-9 px-3.5 bg-[#0a0a10] border-b border-white/5">
        <span
          className={`w-2 h-2 rounded-full ${live ? 'bg-emerald-400 animate-pulse-dot' : 'bg-white/20'}`}
          aria-hidden="true"
        />
        <span className="font-mono text-[11px] tracking-wide text-white/40 lowercase">{title}</span>
      </div>
      {children}
    </div>
  );
}

function Nav() {
  return (
    <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-[#07070b]/80 backdrop-blur-xl overflow-hidden">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-signal-teal animate-pulse-dot" />
          <span className="font-mono font-semibold text-lg tracking-tight lowercase">psydeclip</span>
        </a>
        <div className="flex items-center gap-7">
          <a href="#features" className="hidden sm:block text-sm text-white/50 hover:text-white transition-colors">
            Features
          </a>
          <a href="#gallery" className="hidden sm:block text-sm text-white/50 hover:text-white transition-colors">
            Gallery
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-white/50 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <GithubMark size={16} /> <span className="hidden sm:inline">GitHub</span>
          </a>
          <a
            href={SETUP}
            className="hidden sm:flex text-sm font-medium px-4 py-2 rounded-md border border-signal-teal/40 text-signal-teal hover:bg-signal-teal/10 hover:border-signal-teal transition-colors"
          >
            Download
          </a>
        </div>
      </div>
      <span className="nav-trace" aria-hidden="true" />
    </nav>
  );
}

/** Small spec-sheet strip under the hero — real numbers in mono, the kind of
 *  detail a template landing page never bothers with. */
const SPECS = [
  ['5', 'visualizers'],
  ['14', 'themes'],
  ['0', 'cloud dependency'],
  ['MIT', 'licensed'],
];

function Hero() {
  return (
    <section id="top" className="relative pt-36 pb-20 lg:pt-44 lg:pb-28 overflow-hidden">
      <div className="hero-wash" aria-hidden="true" />
      <div className="max-w-6xl mx-auto px-5 sm:px-8 relative z-10">
        <div className="grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
          <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
            <motion.div
              variants={fadeIn}
              className="inline-flex items-center gap-2 px-3 py-1 border border-white/10 bg-white/[0.03] text-xs font-mono text-white/50 mb-7"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-signal-teal" />
              v{VERSION} &middot; WINDOWS
            </motion.div>

            <motion.h1
              variants={fadeIn}
              className="text-5xl md:text-6xl font-extrabold tracking-tight mb-6 leading-[1.08]"
            >
              Never miss a moment
              <br />
              of <span className="relative inline-block px-1">
                audio
                <svg
                  className="absolute left-0 -bottom-1 w-full"
                  height="10"
                  viewBox="0 0 160 10"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <path
                    className="signal-underline"
                    d="M1 7 C 30 2, 60 9, 90 4 S 140 2, 159 6"
                    stroke="#5ef2d6"
                    strokeWidth="3"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              .
            </motion.h1>

            <motion.p variants={fadeIn} className="text-lg text-white/55 max-w-xl mb-10 leading-relaxed">
              A system audio recorder for Windows that's always quietly capturing into memory. Press{' '}
              <strong className="text-white font-semibold">Save</strong> and the last few minutes — however long you
              buffered — land on disk.
            </motion.p>

            <motion.div variants={fadeIn} className="flex flex-col sm:flex-row items-start gap-4 mb-10">
              <a
                href={SETUP}
                className="px-6 py-3.5 rounded-md bg-signal-teal text-ink-950 font-semibold text-sm hover:brightness-110 active:brightness-95 transition-all flex items-center gap-2 w-full sm:w-auto justify-center"
              >
                <Download size={18} /> Download for Windows
              </a>
              <a
                href="#gallery"
                className="px-6 py-3.5 rounded-md border border-white/15 hover:border-white/30 hover:bg-white/[0.04] transition-colors flex items-center gap-2 w-full sm:w-auto justify-center text-sm font-medium"
              >
                View the gallery
              </a>
            </motion.div>

            <motion.div variants={fadeIn} className="flex flex-wrap gap-x-8 gap-y-3 font-mono text-xs">
              {SPECS.map(([n, label]) => (
                <div key={label}>
                  <span className="text-white font-semibold">{n}</span>{' '}
                  <span className="text-white/40 uppercase tracking-wide">{label}</span>
                </div>
              ))}
            </motion.div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="relative"
          >
            <div className="absolute -inset-6 bg-gradient-to-br from-signal-teal/10 to-signal-violet/10 rounded-2xl blur-2xl" aria-hidden="true" />
            <AppFrame live className="relative shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
              <img
                src="shots-user/classic-grid-recording.png"
                alt="PsydeClip recording live — oscilloscope, spectrum, spectrogram, history and MIDI all reading the same signal"
                width={1108}
                height={624}
                className="w-full block"
              />
            </AppFrame>
          </motion.div>
        </div>
      </div>
      <p className="relative z-10 max-w-6xl mx-auto px-5 sm:px-8 mt-10 text-xs text-white/35">
        v{VERSION} &middot; 83 MB installer, ~330 MB installed &middot; Windows 10 or later. The installer is
        unsigned, so SmartScreen will warn on first run.
      </p>
    </section>
  );
}

const FEATURES = [
  {
    icon: History,
    title: 'Rolling buffer',
    body: 'Capture is always on in memory. Something good just happened? Save grabs the last N minutes — nothing to rewind, nothing missed.',
  },
  {
    icon: Radio,
    title: 'Five live views',
    body: 'Oscilloscope, spectrum, spectrogram, history and a MIDI piano roll, all reading the same signal in real time.',
  },
  {
    icon: Volume2,
    title: 'True loopback',
    body: 'WASAPI per-device capture, not just desktopCapturer — pick the exact output device you want to record.',
  },
  {
    icon: Music,
    title: 'Audio → MIDI',
    body: 'Select a range and transcribe it with Basic Pitch. The notes render on the piano-roll lane before you even export.',
  },
  {
    icon: Scissors,
    title: 'Drag to export',
    body: 'Highlight a stretch of History, the spectrogram or the MIDI notes and drag it straight onto your desktop as a WAV or .mid.',
  },
  {
    icon: Palette,
    title: '14 themes',
    body: 'From a plain classic terminal green to full synthwave. Every visualizer re-themes with it, panel to panel.',
  },
];

function Features() {
  return (
    <section id="features" className="relative py-24 border-t border-white/5">
      <div className="graticule" aria-hidden="true" />
      <div className="max-w-6xl mx-auto px-5 sm:px-8 relative z-10">
        <Kicker>What it does</Kicker>
        <h2 className="text-3xl md:text-4xl font-extrabold text-center mb-16 tracking-tight">
          Built for the moment you almost missed.
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-white/5 border border-white/5">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <motion.div
              key={title}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={fadeIn}
              className="bg-ink-950 p-7 hover:bg-ink-900 transition-colors"
            >
              <Icon size={20} className="text-signal-teal mb-4" strokeWidth={1.75} />
              <h3 className="font-semibold mb-2">{title}</h3>
              <p className="text-sm text-white/50 leading-relaxed">{body}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Real captures of the app, not mockups. */
const SHOTS = [
  { src: 'shots-user/aurora-grid-active.png', alt: 'PsydeClip in the Aurora theme, recording across all five views', w: 1248, h: 870, title: 'aurora.theme' },
  { src: 'shots-user/future-docked-strip.png', alt: 'PsydeClip docked as a thin strip across the top of a monitor, Future theme', w: 1921, h: 166, title: 'future.theme — docked', wide: true },
  { src: 'shots-user/bloodred-grid.png', alt: 'PsydeClip in the Blood Red theme with the grid view', w: 1074, h: 553, title: 'blood-red.theme' },
  { src: 'shots-user/kawaii-grid.png', alt: 'PsydeClip in the Kawaii theme with the grid view', w: 836, h: 410, title: 'kawaii.theme' },
  { src: 'shots-user/modern-midi.png', alt: 'PsydeClip MIDI view in the Modern theme', w: 1074, h: 575, title: 'modern.theme — midi' },
  { src: 'shots-user/red-midi.png', alt: 'PsydeClip MIDI view in the Blood Red theme', w: 1074, h: 575, title: 'blood-red.theme — midi' },
];

function Screenshots() {
  return (
    <section id="gallery" className="py-24 border-t border-white/5">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <Kicker>In practice</Kicker>
        <h2 className="text-2xl md:text-3xl font-extrabold text-center mb-4 tracking-tight">
          Same app, fourteen moods.
        </h2>
        <p className="text-sm text-white/50 max-w-xl mx-auto text-center mb-14">
          Every shot below is a real capture, not a mockup — including this one, recording live.
        </p>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-60px' }}
          variants={fadeIn}
          className="mb-5"
        >
          <AppFrame title="live.gif" live>
            <img
              src="shots-user/live-demo.gif"
              alt="PsydeClip running live, resizing and docking without losing any of its visualizers"
              width={1144}
              height={599}
              className="w-full block"
            />
          </AppFrame>
        </motion.div>

        <div className="grid sm:grid-cols-2 gap-5">
          {SHOTS.map((s) => (
            <motion.div
              key={s.src}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-60px' }}
              variants={fadeIn}
              className={s.wide ? 'sm:col-span-2' : undefined}
            >
              <AppFrame title={s.title}>
                <img src={s.src} alt={s.alt} width={s.w} height={s.h} loading="lazy" className="w-full block" />
              </AppFrame>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TechStack() {
  const stack = ['Electron 30', 'React 18', 'TypeScript 5', 'Vite 5', 'NAudio WASAPI', 'WebM / Opus', 'Basic Pitch'];
  return (
    <section className="py-20 border-t border-white/5">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 text-center">
        <h3 className="font-mono text-xs uppercase tracking-[0.25em] text-white/40 mb-8">Built with</h3>
        <div className="flex flex-wrap justify-center gap-2.5 max-w-3xl mx-auto">
          {stack.map((tech) => (
            <span
              key={tech}
              className="px-4 py-1.5 rounded-md border border-white/10 bg-white/[0.02] font-mono text-[13px] text-white/60"
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
      <div className="max-w-4xl mx-auto px-5 sm:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center mb-12"
        >
          <Kicker>Walkthrough</Kicker>
          <h2 className="text-3xl md:text-4xl font-extrabold tracking-tight">See it in action.</h2>
        </motion.div>

        <motion.div initial="hidden" whileInView="visible" viewport={{ once: true }} variants={fadeIn}>
          <AppFrame title="demo.mp4" className="shadow-[0_0_50px_-15px_rgba(94,242,214,0.15)]">
            <div className="relative w-full aspect-video bg-black">
              <iframe
                className="absolute inset-0 w-full h-full"
                src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}`}
                title="PsydeClip demo video"
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
              />
            </div>
          </AppFrame>
        </motion.div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-16 border-t border-white/10 text-white/50 text-sm">
      <div className="max-w-6xl mx-auto px-5 sm:px-8">
        <div className="grid sm:grid-cols-[1.4fr_1fr_1fr] gap-10 mb-12">
          <div>
            <a href="#top" className="flex items-center gap-2.5 mb-4">
              <span className="w-2 h-2 rounded-full bg-signal-teal" />
              <span className="font-mono font-semibold text-white lowercase">psydeclip</span>
            </a>
            <p className="max-w-sm leading-relaxed">
              Built in Windsor, Ontario. ~330 MB installed; the rolling buffer lives in RAM, so disk only fills as
              fast as you save — about 0.7 MB a minute at the default 96 kbps Opus, ~11 MB a minute for WAV.
            </p>
          </div>
          <div>
            <h4 className="font-mono text-xs uppercase tracking-[0.2em] text-white/30 mb-4">Product</h4>
            <ul className="space-y-2.5">
              <li><a href="#features" className="hover:text-white transition-colors">Features</a></li>
              <li><a href="#gallery" className="hover:text-white transition-colors">Gallery</a></li>
              <li><a href={SETUP} className="hover:text-white transition-colors">Download</a></li>
            </ul>
          </div>
          <div>
            <h4 className="font-mono text-xs uppercase tracking-[0.2em] text-white/30 mb-4">Resources</h4>
            <ul className="space-y-2.5">
              <li><a href={REPO} className="hover:text-white transition-colors">GitHub</a></li>
              <li><a href={`${REPO}/issues`} className="hover:text-white transition-colors">Issues</a></li>
              <li><a href={RELEASE} className="hover:text-white transition-colors">Releases</a></li>
            </ul>
          </div>
        </div>
        <div className="pt-8 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/35">
          <p>MIT License &middot; Copyright &copy; 2026 Chimthuwu</p>
          <p>Windows 10 or later</p>
        </div>
      </div>
    </footer>
  );
}

/** The page's background: the real app, blurred and dimmed, drifting slowly.
 *  See `.ambient-bg` in index.css for why (and the gotcha: the inner layer
 *  has to be opaque, not transparent, or it does nothing — same trap as the
 *  app's own title-bar buttons hit earlier this session). */
function AmbientBackground() {
  return <div className="ambient-bg" aria-hidden="true" />;
}

export default function App() {
  return (
    <div className="relative min-h-screen text-white font-sans overflow-x-hidden">
      <AmbientBackground />
      <div className="relative z-10">
        <Nav />
        <Hero />
        <Video />
        <Features />
        <Screenshots />
        <TechStack />
        <Footer />
      </div>
    </div>
  );
}
