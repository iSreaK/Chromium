#include "third_party/blink/renderer/core/permissions_policy/permissions_policy_parser.h"

// Browser integration for Permissions Policy must propagate to child frames.
class PermissionsPolicyBrowserTest {
 public:
  void SetUp() {}
};

TEST_F(PermissionsPolicyBrowserTest, PropagatesToChildFrame) {
}
