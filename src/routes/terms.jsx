import {createFileRoute} from "@tanstack/react-router";
import LegalPage from "@/components/LegalPage";
export const Route=createFileRoute("/terms")({head:()=>({meta:[{title:"Terms of Service — VICEHUB"}]}),component:()=> <LegalPage slug="terms" title="Terms of Service"/>});
