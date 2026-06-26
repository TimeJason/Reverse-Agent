export const plugin = {
  name: "example-markdown-exporter",
  capabilities: ["exporter"],
  export(data) {
    const title = typeof data?.title === "string" ? data.title : "Analysis Export";
    const items = Array.isArray(data?.items) ? data.items : [];
    return [`# ${title}`, "", ...items.map((item) => `- ${String(item)}`), ""].join("\n");
  }
};
