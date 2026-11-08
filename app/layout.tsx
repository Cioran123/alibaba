export const metadata = { title: "Procurement Dept" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "ui-sans-serif, system-ui", margin: 24, color: "#111" }}>{children}</body>
    </html>
  );
}
