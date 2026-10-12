import React from 'react';
import { motion } from 'framer-motion';
import {
  Download,
  Radio,
  Music,
  Check,
  Keyboard,
  History,
  Volume2,
  Scissors,
} from 'lucide-react';

const REPO = 'https://github.com/Chimthuwu/recordr';
const RELEASE = REPO + '/releases/latest';
const VERSION = '3.2.0';

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

const fadeIn = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6 } },
};

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.1 } },
};

/** Mirrors THEMES in src/shared/types.ts — same order, same labels. */
const THEMES = [
  { slug: 'modern', label: 'Modern neon' },
  { slug: 'classic', label: 'Classic green' },
  { slug: 'cyberpunk', label: 'Cyberpunk' },
  { slug: 'synthwave', label: 'Synthwave' },
  { slug: 'monochrome', label: 'Monochrome' },
  { slug: 'kawaii', label: 'Hyper kawaii ✿' },
  { slug: 'aqua', label: 'Aqua' },
  { slug: 'sakura', label: 'Sakura' },
  { slug: 'lime', label: 'Lime green' },
  { slug: 'blood-red', label: 'Blood red' },
  { slug: 'nocturnal', label: 'Nocturnal' },
  { slug: 'black-ice', label: 'Black ice' },
];

const FEATURES = [
  {
    icon: Radio,
    accent: 'magenta',
    title: 'Rolling buffer',
    body: 'Always recording into memory — 15 minutes by default, configurable. Save writes that slice to disk as WebM/Opus, WAV or MP3, so you never lose the take you did not know you wanted.',
  },
  {
    icon: History,
    accent: 'cyan',
    title: 'Five visualizers',
    body: 'Oscilloscope, spectrum, scrolling spectrogram, a scrubbable History waveform and a MIDI piano roll. Split view shows them at once, in a mosaic that always fills the board.',
  },
  {
    icon: Volume2,
    accent: 'purple',
    title: 'True WASAPI loopback',
    body: 'Capture one output device — speakers, headphones, a virtual cable — through a native NAudio helper, instead of whatever the browser layer hands you for the whole system mix.',
  },
  {
    icon: Scissors,
    accent: 'cyan',
    title: 'Clips and selections',
    body: 'A dedicated record button streams a short clip straight to disk, never through RAM. In History, select a region and drag it out as a WAV, or crop and save it with one key.',
  },
  {
    icon: Music,
    accent: 'magenta',
    title: 'Audio to MIDI',
    body: 'Turn on Transcribe on save and a .mid lands beside the audio, via Basic Pitch on CPU. While you record, a live pitch tracker sketches the melody straight onto the grid.',
  },
  {
    icon: Keyboard,
    accent: 'purple',
    title: 'Hotkeys and tray',
    body: 'Alt+R records a clip from anywhere. The tray icon carries a live recording badge, the elapsed time in its title, and a recent-saves submenu.',
  },
];

const ROADMAP = [
  { done: true, text: 'Renderer crash on capture start (bad_message.cc 263)' },
  { done: true, text: 'Custom dropdowns — no more white text on white' },
  { done: true, text: 'Pop-out visualizer window, dockable across a monitor' },
  { done: true, text: 'MIDI grid with live pitch tracking while recording' },
  { done: false, text: 'By-ear accuracy baseline for audio to MIDI, in a DAW' },
  { done: false, text: 'A signed installer, so SmartScreen stays quiet' },
  { done: false, text: 'Optional mic capture through the same WASAPI helper' },
  { done: false, text: 'An Android build — last item on the list, deliberately' },
];

const ACCENTS = {
  magenta: { ring: 'hover:border-neon-magenta/50', bg: 'bg-neon-magenta/20', fg: 'text-neon-magenta' },
  cyan: { ring: 'hover:border-neon-cyan/50', bg: 'bg-neon-cyan/20', fg: 'text-neon-cyan' },
  purple: { ring: 'hover:border-neon-purple/50', bg: 'bg-neon-purple/20', fg: 'text-neon-purple' },
};

function Nav() {
  return (
    <nav className="fixed top-0 w-full z-50 border-b border-white/10 bg-[#05050A]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <a href="#top" className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-neon-magenta animate-pulse" />
          <span className="font-bold text-xl tracking-tight">recordr</span>
        </a>
        <div className="flex items-center gap-6">
          <a href="#features" className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors">
            Features
          </a>
          <a href="#themes" className="hidden sm:block text-sm text-gray-400 hover:text-white transition-colors">
            Themes
          </a>
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-1.5"
          >
            <GithubMark size={16} /> GitHub
          </a>
        </div>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section id="top" className="relative pt-32 pb-20 lg:pt-44 lg:pb-28 overflow-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] max-w-[160vw] bg-neon-magenta/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute top-1/3 left-1/4 w-[400px] h-[400px] max-w-[120vw] bg-neon-cyan/10 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        <motion.div initial="hidden" animate="visible" variants={staggerContainer}>
          <motion.div
            variants={fadeIn}
            className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-neon-cyan mb-6"
          >
            <span className="w-2 h-2 rounded-full bg-neon-cyan animate-pulse" />
            v{VERSION} · Windows · work in progress
          </motion.div>

          <motion.h1 variants={fadeIn} className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6">
            Never miss a moment of{' '}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-neon-cyan to-neon-magenta">
              audio.
            </span>
          </motion.h1>

          <motion.p variants={fadeIn} className="text-lg md:text-xl text-gray-400 max-w-3xl mx-auto mb-10">
            A rolling-sampler system audio recorder for Windows. It is always quietly recording into memory — press{' '}
            <strong className="text-white">Save</strong> to write the last 15 minutes, or however long you buffered, to
            disk.
          </motion.p>

          <motion.div variants={fadeIn} className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href={RELEASE}
              className="px-8 py-4 rounded-full bg-gradient-to-r from-neon-magenta to-neon-purple text-white font-bold hover:opacity-90 transition-opacity flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              <Download size={20} /> Download for Windows
            </a>
            <a
              href="#features"
              className="px-8 py-4 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition-colors flex items-center gap-2 w-full sm:w-auto justify-center"
            >
              Explore features
            </a>
          </motion.div>

          <motion.p variants={fadeIn} className="mt-4 text-xs text-gray-500 max-w-xl mx-auto">
            The repository is private while this is in progress, so the download needs access. The installer is
            unsigned — SmartScreen will warn on first run.
          </motion.p>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4 }}
        className="max-w-6xl mx-auto px-4 mt-20"
      >
        <div className="relative rounded-2xl border border-white/10 bg-[#0A0A0F] shadow-2xl shadow-neon-magenta/20 overflow-hidden">
          <div className="h-10 bg-[#12121A] border-b border-white/5 flex items-center px-4 gap-2">
            <span className="w-3 h-3 rounded-full bg-red-500/80" />
            <span className="w-3 h-3 rounded-full bg-yellow-500/80" />
            <span className="w-3 h-3 rounded-full bg-green-500/80" />
            <span className="text-xs text-gray-500 ml-4 font-mono">recordr — modern neon</span>
          </div>
          <img
            src="/shots/main-modern.png"
            alt="The Recordr dashboard: transport, VU meter and the visualizer board"
            className="w-full block"
          />
        </div>
      </motion.div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="py-24 relative">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Packed with <span className="text-neon-cyan">power.</span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto">
            Everything you need to capture, watch and keep system audio without interrupting what you were doing.
          </p>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={staggerContainer}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {FEATURES.map(({ icon: Icon, accent, title, body }) => {
            const a = ACCENTS[accent];
            return (
              <motion.div
                key={title}
                variants={fadeIn}
                className={`p-6 rounded-2xl bg-white/5 border border-white/10 transition-colors group ${a.ring}`}
              >
                <div
                  className={`w-12 h-12 rounded-full ${a.bg} ${a.fg} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}
                >
                  <Icon size={24} />
                </div>
                <h3 className="text-xl font-bold mb-2">{title}</h3>
                <p className="text-gray-400 text-sm leading-relaxed">{body}</p>
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}

function Themes() {
  return (
    <section id="themes" className="py-20 overflow-hidden border-y border-white/5 bg-white/[0.02]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center mb-10"
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            Make it <span className="text-neon-purple">yours.</span>
          </h2>
          <p className="text-gray-400">
            Twelve themes, every card a real screenshot of the running app. Swipe through them.
          </p>
        </motion.div>

        <div className="flex gap-6 overflow-x-auto pb-8 snap-x snap-mandatory no-scrollbar">
          {THEMES.map(({ slug, label }) => (
            <figure
              key={slug}
              className="min-w-[280px] md:min-w-[520px] snap-center rounded-2xl border border-white/10 bg-white/5 p-4"
            >
              <img
                src={`/shots/main-${slug}.png`}
                alt={`Recordr in the ${label} theme`}
                loading="lazy"
                className="rounded-lg border border-white/10 w-full block mb-4"
              />
              <figcaption className="font-bold text-center">{label}</figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

function TechStack() {
  const stack = ['Electron 30', 'React 18', 'TypeScript 5', 'Vite 5', 'NAudio WASAPI', 'WebM / Opus', 'Basic Pitch'];
  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        <h2 className="text-2xl font-bold mb-10 text-gray-400">Built on</h2>
        <div className="flex flex-wrap justify-center gap-3 md:gap-4 items-center opacity-70">
          {stack.map((tech) => (
            <span key={tech} className="px-4 py-2 rounded-full border border-white/10 bg-white/5 text-sm font-medium">
              {tech}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Roadmap() {
  return (
    <section className="py-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center mb-16"
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-4">
            The <span className="text-neon-magenta">roadmap</span>
          </h2>
          <p className="text-gray-400">Where it is, and where it goes next.</p>
        </motion.div>

        <div className="space-y-4">
          {ROADMAP.map((item, i) => (
            <motion.div
              key={item.text}
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(i, 5) * 0.08 }}
              viewport={{ once: true }}
              className={`flex items-center gap-4 p-4 rounded-xl border ${
                item.done ? 'border-neon-cyan/30 bg-neon-cyan/5' : 'border-white/10 bg-white/5'
              }`}
            >
              <span
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center border ${
                  item.done ? 'bg-neon-cyan border-neon-cyan text-black' : 'border-gray-500'
                }`}
              >
                {item.done && <Check size={14} strokeWidth={3} />}
              </span>
              <span className={item.done ? 'text-gray-400' : 'text-white'}>{item.text}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="py-12 border-t border-white/10 text-center text-gray-500 text-sm">
      <div className="max-w-7xl mx-auto px-4">
        <p className="mb-4">Built in Windsor, Ontario. Windows 10 or later, and a drive with room for what you keep.</p>
        <p>MIT License · Copyright © 2026 Chimthuwu</p>
        <div className="flex justify-center gap-4 mt-6">
          <a href={REPO} className="hover:text-white transition-colors">
            GitHub
          </a>
          <a href={`${REPO}/issues`} className="hover:text-white transition-colors">
            Issues
          </a>
          <a href={RELEASE} className="hover:text-white transition-colors">
            Releases
          </a>
        </div>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-[#05050A] text-white font-sans">
      <Nav />
      <Hero />
      <Features />
      <Themes />
      <TechStack />
      <Roadmap />
      <Footer />
    </div>
  );
}
