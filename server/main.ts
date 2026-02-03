import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

const WMC_ROOT = join(Deno.cwd(), "..");

interface CompileRequest {
  source: string;
  stage?: "parse" | "lower" | "infer" | "all";
}

interface CompileResponse {
  success: boolean;
  data?: {
    tokens?: unknown;
    ast?: unknown;
    lowered?: unknown;
    types?: unknown;
    raw?: string;
  };
  error?: string;
}

async function compileWorkman(
  source: string,
  stage: string = "all",
): Promise<CompileResponse> {
  // Create temp file in WMC_ROOT so it's accessible via --dir flag
  const tempFileName = `temp_${Date.now()}_${
    Math.random().toString(36).slice(2)
  }.wm`;
  const tempFile = join(WMC_ROOT, tempFileName);

  try {
    await Deno.writeTextFile(tempFile, source);

    // Verify file was created
    const fileExists = await Deno.stat(tempFile).then(() => true).catch(() =>
      false
    );
    console.log("Temp file created:", { path: tempFile, exists: fileExists });

    // Use the new api.gr module that outputs JSON
    // Note: WASI needs absolute paths with forward slashes
    const grainArgs = [
      "--dir",
      WMC_ROOT.replace(/\\/g, "/"),
      "--include-dirs",
      join(WMC_ROOT, "src").replace(/\\/g, "/"),
      join(WMC_ROOT, "src/api/api.gr").replace(/\\/g, "/"),
      "--",
      tempFile.replace(/\\/g, "/"), // Convert Windows path to Unix-style for WASI
    ];

    console.log("Running command:", {
      command: "grain",
      args: grainArgs,
      cwd: WMC_ROOT,
      tempFile: tempFile,
    });

    const cmd = new Deno.Command("grain", {
      args: grainArgs,
      cwd: WMC_ROOT,
      stdout: "piped",
      stderr: "piped",
      env: {
        "GRAIN_STDLIB": Deno.env.get("GRAIN_STDLIB") || "",
      },
    });

    const { code, stdout, stderr } = await cmd.output();
    const output = new TextDecoder().decode(stdout);
    const errorOutput = new TextDecoder().decode(stderr);

    console.log("Command result:", {
      code,
      outputLength: output.length,
      errorLength: errorOutput.length,
    });
    console.log("Raw output:", output.substring(0, 200));

    if (code !== 0) {
      console.error("Compilation failed:", errorOutput);
      return {
        success: false,
        error: errorOutput || output || "Compilation failed",
      };
    }

    // Parse JSON output from api.gr
    try {
      const result = JSON.parse(output);
      return result;
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Full output:", output);
      return {
        success: false,
        error: `Failed to parse JSON: ${
          parseError instanceof Error ? parseError.message : "Unknown error"
        }\nOutput: ${output}`,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    try {
      await Deno.remove(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  if (url.pathname === "/api/compile" && req.method === "POST") {
    try {
      const body: CompileRequest = await req.json();
      const result = await compileWorkman(body.source, body.stage);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : "Invalid request",
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }
  }

  if (url.pathname === "/api/health") {
    return new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return new Response("Not Found", { status: 404 });
};

const port = 3001;
try {
  console.log(
    `🗿 Workmangr Playground API running on http://localhost:${port}`,
  );
  await serve(handler, { port });
} catch (error) {
  if (error instanceof Deno.errors.AddrInUse) {
    // Do nothing, server already running
  } else {
    throw error;
  }
}
