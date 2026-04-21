export async function callTelegramMtproto() {
  return {
    success: false,
    output: null,
    meta: {
      errorMessage: "MTProto provider is not implemented yet. Use providerMode=bot_api in P0."
    }
  };
}
