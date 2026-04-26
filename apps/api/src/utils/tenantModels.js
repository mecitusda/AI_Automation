import { getTenantConnection, getPlatformConnection } from "../config/db.js";
import { getWorkflowModel } from "../models/workflow.model.js";
import { getRunModel } from "../models/run.model.js";
import { getCredentialModel } from "../models/credential.model.js";
import { getTemplateModel } from "../models/template.model.js";
import { getTelegramEventModel } from "../models/telegramEvent.model.js";
import { getTelegramSessionModel } from "../models/telegramSession.model.js";
import { getWorkflowVariableModel } from "../models/workflowVariable.model.js";
import { getUserModel } from "../models/user.model.js";

export function getPlatformModels() {
  const conn = getPlatformConnection();
  return {
    User: getUserModel(conn),
    Workflow: getWorkflowModel(conn),
    Run: getRunModel(conn),
    Credential: getCredentialModel(conn),
    Template: getTemplateModel(conn),
    WorkflowVariable: getWorkflowVariableModel(conn),
    TelegramEvent: getTelegramEventModel(conn),
    TelegramSession: getTelegramSessionModel(conn)
  };
}

export function getTenantModels(tenantId) {
  const conn = getTenantConnection(tenantId);
  return {
    User: getUserModel(conn),
    Workflow: getWorkflowModel(conn),
    Run: getRunModel(conn),
    Credential: getCredentialModel(conn),
    Template: getTemplateModel(conn),
    WorkflowVariable: getWorkflowVariableModel(conn),
    TelegramEvent: getTelegramEventModel(conn),
    TelegramSession: getTelegramSessionModel(conn)
  };
}
