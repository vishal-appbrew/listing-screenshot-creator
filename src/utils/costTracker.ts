import fs from 'fs';
import path from 'path';

// Gemini pricing per million tokens (USD) — https://ai.google.dev/pricing
const GEMINI_PRICING: Record<string, { input: number; output: number }> = {
  'gemini-2.5-flash':       { input: 0.15,  output: 0.60 },
  'gemini-2.0-flash-lite':  { input: 0.075, output: 0.30 },
  'gemini-1.5-pro':         { input: 1.25,  output: 5.00 },
};

const DEFAULT_PRICING = { input: 0.15, output: 0.60 };

export interface GeminiUsage {
  promptTokenCount: number;
  candidatesTokenCount: number;
  totalTokenCount: number;
}

interface UsageEntry {
  timestamp: string;
  purpose: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
  brandName?: string;
}

class CostTracker {
  private entries: UsageEntry[] = [];
  readonly sessionId: string;

  constructor() {
    this.sessionId = new Date().toISOString().slice(0, 19).replace(/[:-]/g, '');
  }

  track(purpose: string, model: string, usage: GeminiUsage | undefined, brandName?: string): UsageEntry {
    const pricing = GEMINI_PRICING[model] ?? DEFAULT_PRICING;
    const inputTokens  = usage?.promptTokenCount      ?? 0;
    const outputTokens = usage?.candidatesTokenCount  ?? 0;
    const costUSD = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;

    const entry: UsageEntry = {
      timestamp: new Date().toISOString(),
      purpose, model, inputTokens, outputTokens, costUSD, brandName,
    };
    this.entries.push(entry);
    console.log(`  💰 ${purpose} [${model}]: ${inputTokens.toLocaleString()} in + ${outputTokens.toLocaleString()} out = $${costUSD.toFixed(4)}`);
    return entry;
  }

  getSessionTotal() {
    return {
      totalCost:   this.entries.reduce((s, e) => s + e.costUSD,       0),
      totalInput:  this.entries.reduce((s, e) => s + e.inputTokens,   0),
      totalOutput: this.entries.reduce((s, e) => s + e.outputTokens,  0),
      callCount:   this.entries.length,
    };
  }

  getBreakdown(): Record<string, { cost: number; calls: number }> {
    const out: Record<string, { cost: number; calls: number }> = {};
    for (const e of this.entries) {
      if (!out[e.purpose]) out[e.purpose] = { cost: 0, calls: 0 };
      out[e.purpose].cost  += e.costUSD;
      out[e.purpose].calls += 1;
    }
    return out;
  }

  printSummary() {
    const t = this.getSessionTotal();
    if (t.callCount === 0) return;
    console.log('\n═══════════════════════════════════════');
    console.log('  💰 COST SUMMARY');
    console.log('═══════════════════════════════════════');
    console.log(`  API calls:     ${t.callCount}`);
    console.log(`  Input tokens:  ${t.totalInput.toLocaleString()}`);
    console.log(`  Output tokens: ${t.totalOutput.toLocaleString()}`);
    console.log(`  Total cost:    $${t.totalCost.toFixed(4)}`);
    console.log('───────────────────────────────────────');
    for (const [purpose, d] of Object.entries(this.getBreakdown())) {
      console.log(`  ${purpose}: ${d.calls} call(s), $${d.cost.toFixed(4)}`);
    }
    console.log('═══════════════════════════════════════\n');
  }

  saveToFile(outputDir: string) {
    try {
      fs.mkdirSync(outputDir, { recursive: true });
      const logFile = path.join(outputDir, `cost-log-${this.sessionId}.json`);
      const data = {
        sessionId: this.sessionId,
        generatedAt: new Date().toISOString(),
        summary: this.getSessionTotal(),
        breakdown: this.getBreakdown(),
        entries: this.entries,
      };
      fs.writeFileSync(logFile, JSON.stringify(data, null, 2));
      console.log(`  📄 Cost log: ${logFile}`);
    } catch (e) {
      console.warn(`  ⚠ Could not save cost log: ${e}`);
    }
  }

  appendToCSV(csvPath: string) {
    try {
      const t = this.getSessionTotal();
      const brand = this.entries[0]?.brandName ?? 'unknown';
      const row = `${new Date().toISOString()},${this.sessionId},${brand},${t.callCount},${t.totalInput},${t.totalOutput},${t.totalCost.toFixed(4)}\n`;
      const header = 'timestamp,session_id,brand,calls,input_tokens,output_tokens,cost_usd\n';
      if (fs.existsSync(csvPath)) {
        fs.appendFileSync(csvPath, row);
      } else {
        fs.writeFileSync(csvPath, header + row);
      }
    } catch (e) {
      console.warn(`  ⚠ Could not update cost CSV: ${e}`);
    }
  }
}

// Singleton — shared across the whole process
export const costTracker = new CostTracker();
