"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";

const team = [
  {
    name: "Marwan Osama",
    role: "AI Engineer",
    focus: "Table Detection Specialist",
    initials: "MO",
    color: "#00d4ff",
    image: "/team/marwan-osama.jpg",
  },
  {
    name: "Ahmed Hussein",
    role: "AI Engineer",
    focus: "TSR Specialist",
    initials: "AH",
    color: "#7c3aed",
    image: "/team/ahmed-hussein.jpg",
  },
  {
    name: "Abdelrahman Soliman",
    role: "AI Engineer",
    focus: "TSR Specialist",
    initials: "AS",
    color: "#00d4ff",
    image: "/team/abdelrahman-soliman.jpg",
  },
  {
    name: "Kareem Halaby",
    role: "AI Engineer",
    focus: "OCR Specialist",
    initials: "KH",
    color: "#7c3aed",
    image: "/team/kareem-halaby.jpg",
  },
  {
    name: "Zeyad Anwar",
    role: "AI Engineer",
    focus: "OCR Specialist",
    initials: "ZA",
    color: "#00d4ff",
    image: "/team/zeyad-anwar.jpg",
  },
];

function MemberAvatar({ member }: { member: (typeof team)[number] }) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      className="w-20 h-20 rounded-2xl flex items-center justify-center text-lg font-bold mx-auto mb-4 relative overflow-hidden"
      style={{
        background: `${member.color}20`,
        border: `1px solid ${member.color}30`,
      }}
    >
      {!imgFailed && (
        <Image
          src={member.image}
          alt={member.name}
          fill
          className="object-cover rounded-2xl"
          onError={() => setImgFailed(true)}
        />
      )}
      {imgFailed && (
        <span style={{ color: member.color }}>{member.initials}</span>
      )}
    </div>
  );
}

export default function AboutPage() {
  return (
    <div className="max-w-5xl mx-auto px-6 py-16">
      {/* Header */}
      <div className="text-center mb-16">
        <span className="inline-block px-3 py-1 rounded-full border border-cyan/20 bg-[rgba(0,212,255,0.1)] text-cyan text-xs font-mono mb-4">
          The Parsers · Macathon 2026
        </span>
        <h1 className="text-4xl md:text-5xl font-black text-text mb-4">
          About the Project
        </h1>
        <p className="text-muted-2 max-w-2xl mx-auto leading-relaxed">
          The Parsers is a Macathon team tackling a real-world data extraction
          problem: turning images of tables into machine-readable structured
          data without manual copying. Our approach involves reviewing over 20
          research papers and current state-of-the-art (SOTA) methods to develop
          an accurate, lightweight solution.
        </p>
      </div>

       {/* Team */}
      <div className="mb-16">
        <h2 className="text-2xl font-bold text-text text-center mb-8">
          The Team
        </h2>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-5">
          {team.map((member) => (
            <div
              key={member.name}
              className="glass rounded-2xl p-6 text-center gradient-border hover:bg-white/[0.05] transition-all"
            >
              <MemberAvatar member={member} />
              <p className="text-text font-semibold text-sm">{member.name}</p>
              <p className="text-xs mt-1" style={{ color: member.color }}>
                {member.role}
              </p>
              <p className="text-muted text-xs mt-2 leading-relaxed">
                {member.focus}
              </p>
            </div>
          ))}
        </div>
      </div>
      
      {/* Project overview */}
      <div className="grid md:grid-cols-2 gap-6 mb-16">
        <div className="glass rounded-2xl p-7 gradient-border">
          <h2 className="text-text font-semibold text-lg mb-2">The Problem</h2>
          <p className="text-muted-2 text-sm leading-relaxed">
            Tables in images — from scanned reports to photos of whiteboards —
            are notoriously hard to digitize. Copy-pasting breaks structure;
            manual entry is slow and error-prone.
          </p>
        </div>
        <div className="glass rounded-2xl p-7 gradient-border">
          <h2 className="text-text font-semibold text-lg mb-2">
            The Solution
          </h2>
          <p className="text-muted-2 text-sm leading-relaxed">
            A three-stage AI pipeline — table detection, structure recognition,
            and OCR — that converts any image containing a table into clean HTML
            and CSV in seconds.
          </p>
        </div>
        <div className="glass rounded-2xl p-7 gradient-border">
          <h2 className="text-text font-semibold text-lg mb-2">Tech Stack</h2>
          <p className="text-muted-2 text-sm leading-relaxed">
            Python · FastAPI · Deep learning models for detection and
            recognition · Tesseract / custom OCR · Next.js · Tailwind CSS
          </p>
        </div>
        <div className="glass rounded-2xl p-7 gradient-border">
          <h2 className="text-text font-semibold text-lg mb-2">Built At</h2>
          <p className="text-muted-2 text-sm leading-relaxed">
            Developed during Macathon 2026 — a competitive AI hackathon focused
            on practical machine learning applications and end-to-end product
            delivery.
          </p>
        </div>
      </div>

      {/* CTA */}
      <div className="text-center">
        <Link
          href="/demo"
          className="inline-block px-10 py-4 rounded-xl bg-cyan text-background font-bold hover:bg-cyan-300 transition-colors glow-cyan"
        >
          Try It Yourself →
        </Link>
      </div>
    </div>
  );
}
