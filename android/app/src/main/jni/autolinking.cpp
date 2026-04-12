#include "autolinking.h"

namespace facebook::react {

std::shared_ptr<TurboModule> autolinking_ModuleProvider(
    const std::string& moduleName,
    const JavaTurboModule::InitParams& params) {
  return nullptr;
}

std::shared_ptr<TurboModule> autolinking_cxxModuleProvider(
    const std::string& moduleName,
    const std::shared_ptr<CallInvoker>& jsInvoker) {
  return nullptr;
}

void autolinking_registerProviders(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry) {}

} // namespace facebook::react
