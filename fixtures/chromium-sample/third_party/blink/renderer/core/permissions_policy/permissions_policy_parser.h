#ifndef THIRD_PARTY_BLINK_RENDERER_CORE_PERMISSIONS_POLICY_PERMISSIONS_POLICY_PARSER_H_
#define THIRD_PARTY_BLINK_RENDERER_CORE_PERMISSIONS_POLICY_PERMISSIONS_POLICY_PARSER_H_

// Parses Permissions Policy declarations from iframe and header contexts.
class PermissionsPolicyParser {
 public:
  PermissionsPolicyParser();
  bool ParsePolicy(const char* input);
};

enum class PermissionsPolicyFeatureDefault {
  kAllowed,
  kBlocked
};

#endif  // THIRD_PARTY_BLINK_RENDERER_CORE_PERMISSIONS_POLICY_PERMISSIONS_POLICY_PARSER_H_
