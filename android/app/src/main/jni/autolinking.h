#pragma once

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/JavaTurboModule.h>
#include <ReactCommon/TurboModule.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>

namespace facebook::react {

std::shared_ptr<TurboModule> autolinking_ModuleProvider(
    const std::string& moduleName,
    const JavaTurboModule::InitParams& params);

std::shared_ptr<TurboModule> autolinking_cxxModuleProvider(
    const std::string& moduleName,
    const std::shared_ptr<CallInvoker>& jsInvoker);

void autolinking_registerProviders(
    std::shared_ptr<const ComponentDescriptorProviderRegistry> registry);

} // namespace facebook::react
