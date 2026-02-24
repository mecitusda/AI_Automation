import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "AI Automation API",
      version: "1.0.0",
      description: "Workflow Automation Engine API"
    },
    servers: [
      {
        url: "http://localhost:4000"
      }
    ]
  },
  apis: ["./apps/api/src/routes/*.js"] // route dosyalarını tarar
};

export const swaggerSpec = swaggerJsdoc(options);