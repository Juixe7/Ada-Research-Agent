"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { 
  ArrowRight, Search, FileText, CheckCircle2, 
  ExternalLink, Layers, ShieldCheck, ChevronRight
} from "lucide-react";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";

export default function PublicLandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Interactive state for Card 3: citation preview toggle
  const [citationOpen, setCitationOpen] = useState(true);

  // If user is already authenticated, redirect to dashboard
  useEffect(() => {
    if (!loading && user) {
      router.push("/dashboard");
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen bg-[#0c0d12] text-[#fafaf9] flex flex-col font-sans relative overflow-x-hidden">
      {/* Soft warm ambient background glow at the top */}
      <div 
        className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[550px] bg-[radial-gradient(ellipse_60%_45%_at_50%_-10%,rgba(245,158,11,0.12),transparent_70%)] z-0" 
      />

      <Navbar />

      {/* ─── Hero Section ─────────────────────────────────────────── */}
      <section className="relative z-10 pt-24 pb-20 md:pt-32 md:pb-28 px-6 max-w-5xl mx-auto w-full text-center flex flex-col items-center">
        {/* Eyebrow Badge */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.05] border border-white/[0.1] text-zinc-300 text-xs font-mono tracking-wider uppercase mb-8"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
          <span>Autonomous Research Engine</span>
        </motion.div>

        {/* Human Headline */}
        <motion.h1 
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-4xl sm:text-6xl md:text-7xl font-serif font-bold tracking-tight text-[#f4f4f5] leading-[1.08] max-w-4xl"
        >
          Research any topic in minutes, <br className="hidden sm:inline" />
          <span className="italic font-normal text-zinc-300 font-serif">not hours.</span>
        </motion.h1>

        {/* Straightforward, Honest Subheadline */}
        <motion.p 
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-6 text-zinc-400 text-base sm:text-lg max-w-2xl leading-relaxed font-sans"
        >
          Ada searches the web, reads through your uploaded PDFs, and writes a comprehensive report with every fact linked directly to its source. No guesswork, no made-up facts.
        </motion.p>

        {/* Clear CTAs */}
        <motion.div 
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="mt-10 flex flex-wrap items-center justify-center gap-3.5"
        >
          <a
            href="/register"
            className="bg-zinc-200 hover:bg-white text-zinc-950 font-semibold px-6 py-3 rounded-lg text-sm shadow-sm flex items-center gap-2 transition-all cursor-pointer"
          >
            <span>Start Free Research</span>
            <ArrowRight className="w-4 h-4" />
          </a>
          <a
            href="/login"
            className="btn-secondary px-6 py-3 rounded-lg text-sm font-medium"
          >
            Sign In to Workspace
          </a>
        </motion.div>
      </section>

      {/* ─── 3 Simple, Practical Feature Cards ────────────────────── */}
      <section id="features" className="relative z-10 py-20 px-6 max-w-6xl mx-auto w-full space-y-16">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-4xl font-serif font-bold text-[#f4f4f5] tracking-tight">
            How Ada does the heavy reading for you.
          </h2>
          <p className="text-sm text-zinc-400">
            A practical tool built for researchers, developers, and analysts who need reliable answers fast.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Ask or Upload */}
          <motion.div 
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4 }}
            className="bg-[#12131a] border border-white/[0.08] rounded-xl p-6 flex flex-col justify-between space-y-6 hover:border-white/[0.18] transition-all"
          >
            <div className="space-y-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold block">
                01 / INPUT
              </span>
              <h3 className="text-lg font-semibold text-[#f4f4f5]">
                Start with a question or your own documents
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Type what you want to learn about, or drag and drop PDFs, articles, and research papers from your private vault.
              </p>
            </div>

            {/* Clean UI Card Preview */}
            <div className="bg-[#161822] border border-white/[0.08] rounded-lg p-4 font-sans text-xs space-y-3">
              <div className="space-y-1">
                <span className="text-[10px] font-mono uppercase text-zinc-400 block">Research Topic</span>
                <p className="text-zinc-200 font-medium">
                  &ldquo;Global solar panel recycling trends in 2025&rdquo;
                </p>
              </div>

              <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white/[0.05] border border-white/[0.08] text-[11px] text-zinc-300">
                  <FileText className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Market_Overview_2025.pdf</span>
                </div>
                <span className="text-[10px] font-mono text-zinc-500">Private Vault</span>
              </div>
            </div>
          </motion.div>

          {/* Card 2: Reads Multiple Sources at Once */}
          <motion.div 
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="bg-[#12131a] border border-white/[0.08] rounded-xl p-6 flex flex-col justify-between space-y-6 hover:border-white/[0.18] transition-all"
          >
            <div className="space-y-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold block">
                02 / INVESTIGATION
              </span>
              <h3 className="text-lg font-semibold text-[#f4f4f5]">
                Cross-checks facts across the web and your files
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Instead of reading 20 open tabs, Ada reviews them all in parallel, checking public articles against your private notes to find what&apos;s accurate.
              </p>
            </div>

            {/* Clean UI Card Preview */}
            <div className="bg-[#161822] border border-white/[0.08] rounded-lg p-4 font-sans text-xs space-y-2">
              <span className="text-[10px] font-mono uppercase text-zinc-400 block mb-2">Sources Checked</span>
              
              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="font-mono text-zinc-300 text-[11px]">reuters.com</span>
                <span className="text-[10px] font-mono text-zinc-300 bg-white/[0.06] border border-white/[0.1] px-2 py-0.5 rounded">Verified</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-white/[0.04]">
                <span className="font-mono text-zinc-300 text-[11px]">sciencedirect.com</span>
                <span className="text-[10px] font-mono text-zinc-300 bg-white/[0.06] border border-white/[0.1] px-2 py-0.5 rounded">Verified</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="font-mono text-zinc-300 text-[11px]">Your Uploaded PDF</span>
                <span className="text-[10px] font-mono text-zinc-300 bg-white/[0.06] border border-white/[0.1] px-2 py-0.5 rounded">Cross-Checked</span>
              </div>
            </div>
          </motion.div>

          {/* Card 3: Click to Verify Any Claim */}
          <motion.div 
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: 0.2 }}
            className="bg-[#12131a] border border-white/[0.08] rounded-xl p-6 flex flex-col justify-between space-y-6 hover:border-white/[0.18] transition-all"
          >
            <div className="space-y-3">
              <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-semibold block">
                03 / CITATION
              </span>
              <h3 className="text-lg font-semibold text-[#f4f4f5]">
                Every sentence has a real receipt
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                Whenever a fact is stated, there&apos;s a numbered link next to it. Click it to read the exact quoted sentence from the original source.
              </p>
            </div>

            {/* Clean UI Card Preview with Subdued Citation */}
            <div className="bg-[#161822] border border-white/[0.08] rounded-lg p-4 font-sans text-xs space-y-2.5">
              <div className="text-zinc-200 leading-relaxed font-serif text-xs">
                &ldquo;Silicon recovery rates reached 95% in commercial recycling facilities across North America&rdquo;
                <button
                  type="button"
                  onClick={() => setCitationOpen(!citationOpen)}
                  className="citation-badge ml-1"
                  title="Click to toggle source quote"
                >
                  [1]
                </button>
              </div>

              {citationOpen && (
                <div className="bg-[#12131a] border border-white/[0.08] border-l-2 border-l-zinc-400 p-2.5 rounded text-[11px] text-zinc-300 space-y-1">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase block font-semibold">
                    Source [1] Verbatim Excerpt
                  </span>
                  <p className="text-zinc-300 italic">
                    &ldquo;...tested yield confirmed 95.2% purity in recovered silicon wafers...&rdquo;
                  </p>
                  <span className="text-[10px] font-mono text-zinc-500 block pt-1">
                    ScienceDirect • Environmental Materials 2025
                  </span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── How It Works (3 Clear Steps) ─────────────────────────── */}
      <section id="how-it-works" className="relative z-10 py-20 px-6 max-w-5xl mx-auto w-full border-t border-white/[0.08]">
        <div className="text-center space-y-3 mb-14">
          <h2 className="text-2xl sm:text-4xl font-serif font-bold text-[#f4f4f5] tracking-tight">
            How It Works
          </h2>
          <p className="text-sm text-zinc-400">
            From a simple question to an exhaustive report in three straightforward steps.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div className="space-y-3">
            <span className="text-xs font-mono text-zinc-400 font-semibold tracking-wider block">
              STEP 01
            </span>
            <h3 className="text-base font-semibold text-[#f4f4f5]">Type your topic</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              Enter any question or attach private notes and PDFs you want included in the analysis.
            </p>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-mono text-zinc-400 font-semibold tracking-wider block">
              STEP 02
            </span>
            <h3 className="text-base font-semibold text-[#f4f4f5]">Ada investigates</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              The engine reads dozens of pages across the web and your documents in parallel to check facts.
            </p>
          </div>

          <div className="space-y-3">
            <span className="text-xs font-mono text-zinc-400 font-semibold tracking-wider block">
              STEP 03
            </span>
            <h3 className="text-base font-semibold text-[#f4f4f5]">Read your report</h3>
            <p className="text-xs text-zinc-400 leading-relaxed">
              You get a well-organized, readable document with clickable citations for every single claim.
            </p>
          </div>
        </div>
      </section>

      {/* ─── Bottom Call to Action ────────────────────────────────── */}
      <section className="relative z-10 py-20 px-6 max-w-4xl mx-auto w-full text-center border-t border-white/[0.08] space-y-6">
        <h2 className="text-3xl sm:text-4xl font-serif font-bold text-[#f4f4f5] tracking-tight">
          Ready to save hours of reading?
        </h2>
        <p className="text-sm text-zinc-400 max-w-lg mx-auto leading-relaxed">
          Start investigating with Ada today. Create a free account and run your first research inquiry in seconds.
        </p>
        <div className="pt-2">
          <a
            href="/register"
            className="bg-zinc-200 hover:bg-white text-zinc-950 font-semibold px-7 py-3.5 rounded-lg text-sm inline-flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <span>Get Started Free</span>
            <ArrowRight className="w-4 h-4" />
          </a>
        </div>
      </section>

      {/* ─── Minimalist Human Footer ──────────────────────────────── */}
      <footer className="relative z-10 mt-auto border-t border-white/[0.08] py-8 px-6 text-center">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="font-serif font-bold text-zinc-300">Ada Research</span>
            <span>•</span>
            <span>Autonomous Investigation Engine</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="/#features" className="hover:text-zinc-300 transition-colors">Features</a>
            <a href="/#how-it-works" className="hover:text-zinc-300 transition-colors">How It Works</a>
            <a href="/architecture" className="hover:text-zinc-300 transition-colors">Architecture</a>
            <a href="/login" className="hover:text-zinc-300 transition-colors">Sign In</a>
            <a href="/register" className="hover:text-zinc-300 transition-colors">Register</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
