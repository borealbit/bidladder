export default {
  fetch() {
    return new Response("Test harness");
  },
} satisfies ExportedHandler<Env>;
