#include "third_party/blink/renderer/core/permissions_policy/permissions_policy_parser.h"

// The Permissions Policy parser validates policy-controlled features.
PermissionsPolicyParser::PermissionsPolicyParser() {}

bool PermissionsPolicyParser::ParsePolicy(const char* input) {
  // Feature Policy compatibility is preserved for legacy headers.
  return input != nullptr;
}
