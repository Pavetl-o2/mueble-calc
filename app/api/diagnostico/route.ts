import { NextResponse } from "next/server";
import { diagnosticar } from "@/lib/llm";

export const runtime = "nodejs";
export const maxDuration = 30;

// ---------------------------------------------------------------
// Sonda de configuracion. Se abre en el navegador:
//   https://tu-app.vercel.app/api/diagnostico
//
// Existe porque desde el cliente no se puede distinguir "el modelo
// tardo" de "la funcion nunca llego a salir a internet". Esta ruta hace
// una llamada barata al proveedor y reporta en cual paso se rompe.
//
// No devuelve la llave nunca, solo si esta puesta y su longitud.
// ---------------------------------------------------------------

export async function GET() {
  return NextResponse.json(await diagnosticar(), {
    headers: { "cache-control": "no-store" },
  });
}
