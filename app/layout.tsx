import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const display = localFont({
  src: "./fonts/Syne[wght].ttf",
  variable: "--font-display",
  weight: "400 800",
  display: "swap",
});

const sans = localFont({
  src: [
    { path: "./fonts/InstrumentSans[wdth,wght].ttf", style: "normal", weight: "400 700" },
    { path: "./fonts/InstrumentSans-Italic[wdth,wght].ttf", style: "italic", weight: "400 700" },
  ],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Xólotl · character swap on your own GPU",
  description:
    "Swap the person in a video for the character in one image. MiniMax H3 + SAM 3.1 on your own ComfyUI, fully open weights, nothing leaves your machine.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
