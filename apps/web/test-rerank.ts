import { pipeline } from "@huggingface/transformers";

async function main() {
  const ranker = await pipeline("text-classification", "Xenova/bge-reranker-base");
  try {
    const res = await ranker("What is this?", "This is a document.");
    console.log("String args:", res);
  } catch(e) { console.error("String args failed", e.message); }

  try {
    const res2 = await ranker({ text: "What is this?", text_pair: "This is a document." });
    console.log("Object args:", res2);
  } catch(e) { console.error("Object args failed", e.message); }

  try {
    const res3 = await ranker([["What is this?", "This is a document."]]);
    console.log("Array of pairs:", res3);
  } catch(e) { console.error("Array of pairs failed", e.message); }
}

main();
