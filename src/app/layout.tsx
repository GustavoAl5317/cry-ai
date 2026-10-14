import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Copiloto de Reuniao",
  description: "Respostas ao vivo para perguntas de clientes durante reunioes",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body className="bg-neutral-950 antialiased">{children}</body>
    </html>
  );
}
