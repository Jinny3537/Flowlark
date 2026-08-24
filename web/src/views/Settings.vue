<template>
  <div :class="['settings-panel', { 'page-pad': !embedded, 'settings-panel-embedded': embedded }]">
    <h2 v-if="!embedded" style="margin:0 0 4px;font-size:20px">设置</h2>
    <div class="text-secondary" :style="{ marginBottom: embedded ? '16px' : '20px' }">
      配置存在仓库根目录的 <span class="mono">flowlark.json</span> 里，随 Git 一起提交，团队共用同一份。
    </div>

    <a-alert v-for="p in problems" :key="p" type="warning" show-icon :message="p" style="margin-bottom:12px" />

    <a-alert v-if="!app.canWrite" type="info" show-icon style="margin-bottom:16px"
             message="只读模式" description="这是别人共享出来的视图，设置项不可修改。" />

    <a-spin :spinning="loading">
      <div class="settings-layout">
        <aside class="settings-nav" aria-label="设置分区">
          <button v-for="section in sections" :key="section.key" class="settings-nav-item"
                  :class="{ 'settings-nav-item-active': activeSection === section.key }"
                  type="button" @click="selectSection(section.key)">
            <component :is="section.icon" />
            <span>{{ section.label }}</span>
            <a-badge :count="section.modified" :number-style="{ backgroundColor: '#0E9384' }" />
          </button>
        </aside>

        <div class="settings-content">
          <div class="settings-current">
            <component :is="activeMeta.icon" />
            <div>
              <div class="settings-current-title">{{ activeMeta.label }}</div>
              <div class="text-secondary" style="font-size:12px">{{ activeMeta.description }}</div>
            </div>
          </div>

          <section v-if="activeSection === 'workspace'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><IconApps />工作区</span>
              </template>
              <template #extra>
                <a-space>
                  <a-tooltip title="重建本机跨工作区搜索索引">
                    <a-button size="small" :loading="indexing" @click="rebuildWorkspaceIndex">
                      <template #icon><IconRefresh /></template>重建索引
                    </a-button>
                  </a-tooltip>
                  <a-button size="small" :loading="workspaceLoading" @click="loadWorkspaces">
                    <template #icon><IconRefresh /></template>刷新
                  </a-button>
                </a-space>
              </template>

              <div class="text-secondary" style="font-size:13px;margin-bottom:12px">
                这里管理本机可打开的 Flowlark 仓库。注册表只保存在本机，用于切换、镜像和跨工作区搜索。
              </div>

              <div class="current-workspace-card">
                <div class="current-workspace-main">
                  <IconApps />
                  <div>
                    <div class="current-workspace-title">当前工作区</div>
                    <div class="mono current-workspace-path">{{ app.repo || '尚未加载工作区' }}</div>
                  </div>
                </div>
                <a-button size="small" :disabled="!app.repo" @click="copy(app.repo)">
                  <template #icon><IconCopy /></template>
                  复制路径
                </a-button>
              </div>

              <a-tabs v-model:activeKey="workspaceMode" class="settings-tabs">
                <a-tab-pane key="existing" tab="已有仓库" />
                <a-tab-pane key="clone" tab="从 Git clone" />
              </a-tabs>

              <a-form layout="vertical" class="workspace-form">
                <a-form-item v-if="workspaceMode === 'clone'" label="Git 地址" required>
                  <a-input v-model="workspaceForm.url" placeholder="git@host:team/prototypes.git" />
                </a-form-item>
                <a-form-item label="本机目录" required>
                  <a-input v-model="workspaceForm.path" placeholder="/Users/name/Prototypes" />
                </a-form-item>
                <div class="workspace-form-grid">
                  <a-form-item label="显示名称">
                    <a-input v-model="workspaceForm.name" />
                  </a-form-item>
                  <a-form-item label="模式">
                    <a-checkbox v-model="workspaceForm.mirror">只读镜像</a-checkbox>
                  </a-form-item>
                </div>
                <a-button type="primary" :loading="workspaceSaving" @click="saveWorkspace">
                  {{ workspaceMode === 'clone' ? 'Clone 并注册' : '注册工作区' }}
                </a-button>
              </a-form>

              <a-divider style="margin:18px 0" />

              <a-list :data="workspaces.items" :loading="workspaceLoading" bordered>
                <template #renderItem="{ item }">
                  <a-list-item>
                    <template #actions>
                      <a-button type="text" status="danger" size="small" @click="removeWorkspace(item.path)">移除</a-button>
                    </template>
                    <a-list-item-meta :title="item.name" :description="item.path" />
                    <a-tag :color="item.missing ? 'red' : item.mode === 'mirror' ? 'gold' : 'green'">
                      {{ item.missing ? '路径缺失' : item.mode === 'mirror' ? '只读镜像' : '可用' }}
                    </a-tag>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </section>

          <section v-else-if="activeSection === 'softwareUpdate'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><IconRefresh />软件更新</span>
              </template>
              <template #extra>
                <a-button size="small" :loading="updateChecking" @click="checkSoftwareUpdate">
                  <template #icon><IconRefresh /></template>检测更新
                </a-button>
              </template>

              <div class="text-secondary" style="font-size:13px;margin-bottom:12px">
                从当前 Flowlark 软件目录的 Git 上游远端拉取更新。更新完成后需要重启服务，新的前端资源和后端代码才会生效。
              </div>

              <a-alert v-if="softwareUpdate.error" type="warning" show-icon style="margin-bottom:12px"
                       :message="softwareUpdate.error" />

              <div class="update-info-card">
                <div class="update-info-row">
                  <span>当前客户端版本</span>
                  <strong class="mono">{{ softwareUpdate.currentVersion || app.version || '未知' }}</strong>
                </div>
                <div class="update-info-row">
                  <span>远端软件版本</span>
                  <strong class="mono">{{ softwareUpdate.latestVersion || '未检测' }}</strong>
                </div>
                <div class="update-info-row">
                  <span>软件目录</span>
                  <strong class="mono update-path">{{ softwareUpdate.path || '未知' }}</strong>
                </div>
                <div class="update-info-row">
                  <span>上游远端</span>
                  <strong class="mono update-path">{{ softwareUpdate.upstream || softwareUpdate.remoteUrl || '未配置' }}</strong>
                </div>
              </div>

              <div class="update-status-card" :class="{ 'update-status-card-ready': softwareUpdate.available }">
                <IconRefresh :spin="updateApplying" />
                <div>
                  <div style="font-weight:650;color:var(--fl-ink)">{{ updateStatusTitle }}</div>
                  <div class="text-secondary" style="font-size:var(--fl-fs-2);line-height:1.8">{{ updateStatusText }}</div>
                </div>
              </div>

              <div v-if="softwareUpdate.notes" class="update-notes">
                <div style="font-weight:650;margin-bottom:8px">版本说明</div>
                <pre>{{ softwareUpdate.notes }}</pre>
              </div>

              <a-space wrap class="update-actions">
                <a-button type="primary" :loading="updateApplying"
                          :disabled="!softwareUpdate.available || softwareUpdate.dirty"
                          @click="confirmSoftwareUpdate">
                  <template #icon><IconRefresh /></template>
                  {{ updateApplying ? '更新中...' : '拉取并更新' }}
                </a-button>
                <a-button :disabled="!softwareUpdate.remoteUrl" @click="copy(softwareUpdate.remoteUrl)">
                  <template #icon><IconCopy /></template>复制远端地址
                </a-button>
              </a-space>
            </a-card>
          </section>

          <!-- 局域网分享单独提到最上面：它是最需要「看一眼就知道怎么用」的功能 -->
          <section v-else-if="activeSection === 'lan'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><IconShareExternal />局域网分享</span>
              </template>
              <template #extra>
                <a-switch :checked="lanOn" :disabled="!app.canWrite" :loading="lanBusy"
                          @change="toggleLan" checked-children="开" un-checked-children="关" />
              </template>

              <template v-if="lanOn">
                <div v-if="lanInfo && lanInfo.addresses.length">
                  <div class="text-secondary" style="font-size:13px;margin-bottom:10px">
                    把下面的地址发给同事，他们在同一网段就能直接打开看原型：
                  </div>
                  <div v-for="a in lanInfo.addresses" :key="a.address" class="lan-addr">
                    <span class="mono">http://{{ a.address }}:{{ lanInfo.port }}</span>
                    <span class="text-secondary" style="font-size:12px">{{ a.iface }}</span>
                    <a-tooltip title="复制地址">
                      <a-button size="small" type="text" @click="copy(`http://${a.address}:${lanInfo.port}`)">
                        <IconCopy />
                      </a-button>
                    </a-tooltip>
                  </div>
                </div>
                <a-empty v-else description="没有检测到局域网地址，可能没连网络" :image="simpleImage" />

                <a-divider style="margin:16px 0" />

                <div class="inline-setting">
                  <a-switch :checked="readonlyOn" :disabled="!app.canWrite"
                            @change="(v) => save('server.readonlyFromLan', v)" />
                  <div style="flex:1">
                    <div style="font-weight:500">局域网只读</div>
                    <div class="text-secondary" style="font-size:12.5px;line-height:1.8">
                      开启时局域网来的请求只能查看，写操作仅限运行 Flowlark 的这台机器。
                      <span v-if="!readonlyOn" style="color:#ff4d4f">
                        当前已关闭，同网段任何人都能删版本、改基线。
                      </span>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else>
                <div class="text-secondary" style="font-size:13px;line-height:1.9">
                  当前只监听 127.0.0.1，别人访问不到。<br>
                  开启后同网段的同事可以直接打开工作台看原型，默认只读。
                </div>
              </template>

              <a-alert v-if="restartNeeded" type="warning" show-icon style="margin-top:14px"
                       message="改动需要重启服务才生效"
                       description="请关闭当前 Flowlark 窗口后重新启动应用，新的端口和网络配置才会生效。" />
            </a-card>
          </section>

          <section v-else-if="activeSection === 'gitRemote'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><IconBranch />Git 远端</span>
              </template>
              <div class="text-secondary" style="font-size:13px;margin-bottom:12px">
                配置后，Git 面板和功能台的同步按钮就能把原型、规格书、附件推给团队。
              </div>
              <a-input-group compact>
                <a-input v-model="remoteUrl" class="remote-input"
                         placeholder="git@github.com:team/prototypes.git" :disabled="!app.canWrite" />
                <a-button type="primary" :disabled="!app.canWrite || !remoteUrl.trim()" @click="saveRemote">
                  保存
                </a-button>
                <a-button status="danger" :disabled="!app.canWrite || !currentRemote" @click="clearRemote">移除</a-button>
              </a-input-group>
              <div v-if="currentRemote" class="text-secondary" style="font-size:12px;margin-top:8px">
                当前：<span class="mono">{{ currentRemote.url }}</span>
              </div>
            </a-card>
          </section>

          <section v-else-if="activeSection === 'oplog'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><IconHistory />操作日志</span>
              </template>
              <OpLog embedded />
            </a-card>
          </section>

          <section v-else-if="activeSection === 'mcp'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><IconCode />MCP 中心</span>
              </template>
              <template #extra>
                <a-space>
                  <a-button size="small" :loading="mcpLoading" @click="loadMcpConfig">
                    <template #icon><IconRefresh /></template>刷新
                  </a-button>
                  <a-button size="small" type="primary" :disabled="!app.canWrite" @click="newMcpServer">
                    新增服务
                  </a-button>
                </a-space>
              </template>

              <a-alert v-for="p in mcpProblems" :key="p" type="warning" show-icon :message="p" style="margin-bottom:12px" />

              <div class="mcp-summary-grid">
                <div class="mcp-summary-item">
                  <div class="mcp-summary-value">{{ mcpServers.length }}</div>
                  <div class="text-secondary">服务</div>
                </div>
                <div class="mcp-summary-item">
                  <div class="mcp-summary-value">{{ mcpEnabledCapabilities.length }}</div>
                  <div class="text-secondary">已启用模块</div>
                </div>
                <div class="mcp-summary-item">
                  <div class="mcp-summary-value">{{ mcpExists ? '已创建' : '未创建' }}</div>
                  <div class="text-secondary"><span class="mono">{{ mcpFile }}</span></div>
                </div>
              </div>

              <div class="mcp-grid">
                <div>
                  <div class="mcp-subtitle">MCP 服务</div>
                  <a-list :data="mcpServers" :loading="mcpLoading" bordered>
                    <template #renderItem="{ item }">
                      <a-list-item>
                        <template #actions>
                          <a-button size="small" type="text" @click="editMcpServer(item)">编辑</a-button>
                          <a-button size="small" type="text" status="danger" :disabled="!app.canWrite" @click="removeMcpServer(item.id)">删除</a-button>
                        </template>
                        <a-list-item-meta>
                          <template #title>
                            <span class="mono">{{ item.id }}</span>
                            <a-tag :color="item.enabled ? 'green' : 'default'" style="margin-left:8px">{{ item.enabled ? '启用' : '停用' }}</a-tag>
                          </template>
                          <template #description>
                            <div>{{ item.name }}</div>
                            <div class="mono mcp-url">{{ item.url }}</div>
                          </template>
                        </a-list-item-meta>
                      </a-list-item>
                    </template>
                  </a-list>
                </div>

                <div>
                  <div class="mcp-subtitle">{{ mcpEditingExisting ? '编辑 MCP 服务' : '新增 MCP 服务' }}</div>
                  <a-form layout="vertical">
                    <div class="mcp-form-grid">
                      <a-form-item label="服务标识" required>
                        <a-input v-model="mcpServerForm.id" class="mono" placeholder="requirements-mcp" :disabled="mcpEditingExisting || !app.canWrite" />
                      </a-form-item>
                      <a-form-item label="显示名称">
                        <a-input v-model="mcpServerForm.name" placeholder="需求系统 MCP" :disabled="!app.canWrite" />
                      </a-form-item>
                    </div>
                    <a-form-item label="MCP URL" required>
                      <a-input v-model="mcpServerForm.url" placeholder="http://127.0.0.1:9000/mcp" :disabled="!app.canWrite" />
                    </a-form-item>
                    <a-form-item label="本机密钥">
                      <a-input-password v-model="mcpSecret" placeholder="不会写入仓库，只在本机保存" :disabled="!app.canWrite || !mcpServerForm.id" />
                    </a-form-item>
                    <a-space wrap>
                      <a-button type="primary" :loading="mcpSaving" :disabled="!app.canWrite" @click="saveMcpServer">保存服务</a-button>
                      <a-button :disabled="!app.canWrite || !mcpSecret || !mcpServerForm.id" @click="saveMcpSecret">保存密钥</a-button>
                      <a-button @click="newMcpServer">清空</a-button>
                    </a-space>
                    <a-collapse ghost class="mcp-advanced">
                      <a-collapse-panel key="service-advanced" header="高级设置">
                        <div class="mcp-form-grid">
                          <a-form-item label="类型">
                            <a-select v-model="mcpServerForm.type" :disabled="!app.canWrite">
                              <a-option value="http">HTTP JSON-RPC</a-option>
                            </a-select>
                          </a-form-item>
                          <a-form-item label="状态">
                            <a-checkbox v-model="mcpServerForm.enabled" :disabled="!app.canWrite">启用服务</a-checkbox>
                          </a-form-item>
                        </div>
                        <a-form-item label="请求头 JSON">
                          <a-textarea v-model="mcpServerForm.headersText" :rows="4" class="mono" :disabled="!app.canWrite"
                                      placeholder='{"Authorization":"Bearer ${secret}"}' />
                        </a-form-item>
                        <a-button status="danger" :disabled="!app.canWrite || !mcpServerForm.id" @click="deleteMcpSecret">删除本机密钥</a-button>
                      </a-collapse-panel>
                    </a-collapse>
                  </a-form>
                </div>
              </div>

              <a-divider />

              <div class="mcp-subtitle">需求能力映射</div>
              <a-form layout="vertical">
                <div class="mcp-form-grid">
                  <a-form-item label="启用">
                    <a-checkbox v-model="mcpRequirement.enabled" :disabled="!app.canWrite">通过 MCP 搜索、导入和回写需求</a-checkbox>
                  </a-form-item>
                  <a-form-item label="绑定服务">
                    <a-select v-model="mcpRequirement.server" :disabled="!app.canWrite" placeholder="选择 MCP 服务">
                      <a-option v-for="server in mcpServers" :key="server.id" :value="server.id">{{ server.name }} · {{ server.id }}</a-option>
                    </a-select>
                  </a-form-item>
                </div>
                <a-form-item label="外部项目标识">
                  <a-input v-model="mcpRequirement.project" :disabled="!app.canWrite" placeholder="可选，如需求空间、Jira Project Key" />
                </a-form-item>
                <a-space wrap>
                  <a-button type="primary" :loading="mcpSaving" :disabled="!app.canWrite" @click="saveMcpRequirement">保存映射</a-button>
                  <a-button :loading="mcpTesting" :disabled="!mcpRequirement.enabled" @click="testMcpRequirement">测试连接</a-button>
                </a-space>
                <a-collapse ghost class="mcp-advanced">
                  <a-collapse-panel key="requirements-tools" header="工具名">
                    <div class="mcp-tools-grid">
                      <a-form-item label="连接测试工具"><a-input v-model="mcpRequirement.tools.test" class="mono" :disabled="!app.canWrite" /></a-form-item>
                      <a-form-item label="搜索工具"><a-input v-model="mcpRequirement.tools.search" class="mono" :disabled="!app.canWrite" /></a-form-item>
                      <a-form-item label="详情工具"><a-input v-model="mcpRequirement.tools.get" class="mono" :disabled="!app.canWrite" /></a-form-item>
                      <a-form-item label="评论工具"><a-input v-model="mcpRequirement.tools.comment" class="mono" :disabled="!app.canWrite" /></a-form-item>
                    </div>
                  </a-collapse-panel>
                </a-collapse>
              </a-form>

              <a-divider />

              <div class="mcp-subtitle">迭代能力映射</div>
              <a-form layout="vertical">
                <div class="mcp-form-grid">
                  <a-form-item label="启用">
                    <a-checkbox v-model="mcpMilestone.enabled" :disabled="!app.canWrite">通过 MCP 拉取和回写任务平台迭代计划</a-checkbox>
                  </a-form-item>
                  <a-form-item label="绑定服务">
                    <a-select v-model="mcpMilestone.server" :disabled="!app.canWrite" placeholder="选择 MCP 服务">
                      <a-option v-for="server in mcpServers" :key="server.id" :value="server.id">{{ server.name }} · {{ server.id }}</a-option>
                    </a-select>
                  </a-form-item>
                </div>
                <a-form-item label="外部项目标识">
                  <a-input v-model="mcpMilestone.project" :disabled="!app.canWrite" placeholder="可选，如任务平台项目 Key" />
                </a-form-item>
                <a-space wrap>
                  <a-button type="primary" :loading="mcpSaving" :disabled="!app.canWrite" @click="saveMcpMilestone">保存映射</a-button>
                  <a-button :loading="mcpTesting" :disabled="!mcpMilestone.enabled" @click="testMcpMilestone">测试连接</a-button>
                </a-space>
                <a-collapse ghost class="mcp-advanced">
                  <a-collapse-panel key="milestones-tools" header="工具名">
                    <div class="mcp-tools-grid">
                      <a-form-item label="连接测试工具"><a-input v-model="mcpMilestone.tools.test" class="mono" :disabled="!app.canWrite" /></a-form-item>
                      <a-form-item label="列表工具"><a-input v-model="mcpMilestone.tools.list" class="mono" :disabled="!app.canWrite" /></a-form-item>
                      <a-form-item label="详情工具"><a-input v-model="mcpMilestone.tools.get" class="mono" :disabled="!app.canWrite" /></a-form-item>
                      <a-form-item label="新建/更新工具"><a-input v-model="mcpMilestone.tools.upsert" class="mono" :disabled="!app.canWrite" /></a-form-item>
                    </div>
                  </a-collapse-panel>
                </a-collapse>
              </a-form>

              <a-divider />

              <a-collapse ghost class="mcp-extensions">
                <a-collapse-panel key="extensions" :header="`扩展模块（${mcpCustomCapabilities.length}）`">
                  <div class="text-secondary" style="font-size:12.5px;line-height:1.8;margin-bottom:12px">
                    只有新业务页面已经接入某个 MCP 能力时，才需要在这里增加模块映射。
                  </div>
                  <div class="mcp-grid">
                <a-list :data="mcpCustomCapabilities" :loading="mcpLoading" bordered>
                  <template #renderItem="{ item }">
                    <a-list-item>
                      <template #actions>
                        <a-button size="small" type="text" @click="editMcpExtension(item.name, item.capability)">编辑</a-button>
                        <a-button size="small" type="text" status="danger" :disabled="!app.canWrite" @click="removeMcpExtension(item.name)">删除</a-button>
                      </template>
                      <a-list-item-meta>
                        <template #title>
                          <span>{{ item.capability.label }}</span>
                          <span class="mono" style="margin-left:8px">{{ item.name }}</span>
                          <a-tag :color="item.capability.enabled ? 'green' : 'default'" style="margin-left:8px">
                            {{ item.capability.enabled ? '启用' : '停用' }}
                          </a-tag>
                        </template>
                        <template #description>
                          <div>{{ item.capability.description || '未填写说明' }}</div>
                          <div class="text-secondary" style="font-size:12px">
                            {{ item.capability.category || 'extension' }} · {{ item.capability.server || '未绑定服务' }}
                          </div>
                        </template>
                      </a-list-item-meta>
                    </a-list-item>
                  </template>
                </a-list>

                <a-form layout="vertical">
                  <div class="mcp-form-grid">
                    <a-form-item label="能力标识" required>
                      <a-input v-model="mcpExtensionForm.name" class="mono" placeholder="tickets" :disabled="mcpExtensionEditing || !app.canWrite" />
                    </a-form-item>
                    <a-form-item label="显示名称">
                      <a-input v-model="mcpExtensionForm.label" placeholder="工单" :disabled="!app.canWrite" />
                    </a-form-item>
                  </div>
                  <div class="mcp-form-grid">
                    <a-form-item label="启用">
                      <a-checkbox v-model="mcpExtensionForm.enabled" :disabled="!app.canWrite">启用扩展能力</a-checkbox>
                    </a-form-item>
                    <a-form-item label="绑定服务">
                      <a-select v-model="mcpExtensionForm.server" :disabled="!app.canWrite" placeholder="选择 MCP 服务">
                        <a-option v-for="server in mcpServers" :key="server.id" :value="server.id">{{ server.name }} · {{ server.id }}</a-option>
                      </a-select>
                    </a-form-item>
                  </div>
                  <div class="mcp-form-grid">
                    <a-form-item label="分类">
                      <a-input v-model="mcpExtensionForm.category" class="mono" placeholder="extension" :disabled="!app.canWrite" />
                    </a-form-item>
                    <a-form-item label="外部项目标识">
                      <a-input v-model="mcpExtensionForm.project" placeholder="可选" :disabled="!app.canWrite" />
                    </a-form-item>
                  </div>
                  <a-form-item label="说明">
                    <a-input v-model="mcpExtensionForm.description" placeholder="这个模块通过 MCP 提供的能力" :disabled="!app.canWrite" />
                  </a-form-item>
                  <a-form-item label="工具映射 JSON">
                    <a-textarea v-model="mcpExtensionForm.toolsText" :rows="5" class="mono" :disabled="!app.canWrite"
                                placeholder='{"test":"tickets.test","search":"tickets.search","get":"tickets.get"}' />
                  </a-form-item>
                  <a-space wrap>
                    <a-button type="primary" :loading="mcpSaving" :disabled="!app.canWrite" @click="saveMcpExtension">保存扩展能力</a-button>
                    <a-button :loading="mcpTesting" :disabled="!mcpExtensionForm.enabled || !mcpExtensionForm.name" @click="testMcpExtension">测试连接</a-button>
                    <a-button @click="newMcpExtension">清空</a-button>
                  </a-space>
                </a-form>
                  </div>
                </a-collapse-panel>
              </a-collapse>
            </a-card>
          </section>

          <section v-for="g in visibleGroups" :key="g.key" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><component :is="groupIcon(g.key)" />{{ g.label }}</span>
              </template>
              <div v-for="item in g.items" :key="item.key" class="cfg-row">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:500">
                    {{ item.label }}
                    <a-tag v-if="item.danger" color="red" style="margin-left:6px">高风险</a-tag>
                    <a-tag v-if="!item.isDefault" color="green" style="margin-left:6px">已修改</a-tag>
                  </div>
                  <div v-if="item.note" class="text-secondary" style="font-size:12.5px;line-height:1.8">
                    {{ item.note }}
                  </div>
                  <div class="mono text-secondary" style="font-size:11px;margin-top:2px">{{ item.key }}</div>
                </div>

                <div class="cfg-control">
                  <a-switch v-if="item.type === 'bool'" :checked="item.value" :disabled="!app.canWrite"
                            @change="(v) => confirmSave(item, v)" />

                  <a-select v-else-if="item.enum" :value="item.value" style="width:150px" :disabled="!app.canWrite"
                            @change="(v) => save(item.key, v)">
                    <a-option v-for="o in item.enum" :key="o" :value="o">{{ o }}</a-option>
                  </a-select>

                  <a-input-number v-else-if="item.type === 'port' || item.type === 'int'"
                                  :value="item.value" style="width:130px" :disabled="!app.canWrite"
                                  :min="numberMin(item)" :max="numberMax(item)"
                                  @change="(v) => save(item.key, v)" />

                  <a-input v-else-if="item.type === 'bytes'" :value="bytesText(item.value)" style="width:130px"
                           :disabled="!app.canWrite" placeholder="10MB"
                           @blur="(e) => save(item.key, e.target.value)" />

                  <a-select v-else-if="item.type === 'list'" :value="item.value" mode="tags" style="width:230px"
                            :disabled="!app.canWrite" placeholder="回车添加"
                            @change="(v) => save(item.key, v.join(','))" />

                  <a-input v-else :value="item.value" style="width:230px" :disabled="!app.canWrite"
                           :placeholder="String(item.default || '')"
                           @blur="(e) => save(item.key, e.target.value)" />

                  <a-tooltip title="恢复默认值">
                    <a-button v-if="!item.isDefault && app.canWrite" type="text" size="small"
                              @click="reset(item.key)"><IconUndo /></a-button>
                  </a-tooltip>
                </div>
              </div>
            </a-card>
          </section>
        </div>
      </div>

      <div class="text-secondary" style="font-size:12px;margin-bottom:24px">
        仓库配置会写入根目录的 <span class="mono">flowlark.json</span>；工作区注册表只保存在本机。
      </div>
    </a-spin>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { confirmAction, confirmDanger, notify } from '../ui/feedback'
import {
  IconCode, IconApps, IconBranch, IconCheckCircle, IconCopy, IconDesktop,
  IconExperiment, IconHistory, IconRefresh, IconShareExternal, IconSettings, IconUndo
} from '@arco-design/web-vue/es/icon/index.js'
import { api } from '../api'
import { useAppStore } from '../store'
import OpLog from './OpLog.vue'

const props = defineProps({
  embedded: { type: Boolean, default: false }
})

const app = useAppStore()
const route = useRoute()
const router = useRouter()
const simpleImage = null

const items = ref([])
const problems = ref([])
const loading = ref(false)
const restartNeeded = ref(false)
const lanInfo = ref(null)
const lanBusy = ref(false)
const currentRemote = ref(null)
const remoteUrl = ref('')
const activeSection = ref('workspace')
const workspaceLoading = ref(false)
const workspaceSaving = ref(false)
const indexing = ref(false)
const updateChecking = ref(false)
const updateApplying = ref(false)
const softwareUpdate = ref({})
const workspaces = ref({ items: [] })
const workspaceMode = ref('existing')
const workspaceForm = ref({ url: '', path: '', name: '', mirror: false })
const mcpLoading = ref(false)
const mcpSaving = ref(false)
const mcpTesting = ref(false)
const mcpInfo = ref({ file: 'mcp.json', exists: false, config: { servers: [], capabilities: {} }, problems: [] })
const mcpSecret = ref('')
const mcpEditingExisting = ref(false)
const mcpServerForm = ref(defaultMcpServer())
const mcpRequirement = ref(defaultMcpRequirement())
const mcpMilestone = ref(defaultMcpMilestone())
const mcpExtensionEditing = ref(false)
const mcpExtensionForm = ref(defaultMcpExtension())

const GROUP_LABELS = {
  server: '服务与网络',
  git: 'Git 与身份',
  rules: '业务规则',
  integrations: '反馈与集成',
  ui: '外观与默认值'
}
const GROUP_ICONS = {
  server: IconSettings,
  git: IconBranch,
  rules: IconCheckCircle,
  integrations: IconCode,
  ui: IconDesktop
}
const SECTION_DESCRIPTIONS = {
  workspace: '注册、克隆、镜像和索引本机 Flowlark 工作区。',
  softwareUpdate: '检查 Flowlark 软件远端仓库，并拉取快进更新。',
  mcp: '集中管理外部 MCP 服务和可用业务模块。',
  lan: '给同网段成员开放查看入口，并控制局域网写入权限。',
  gitRemote: '设置团队同步用的 Git origin 地址。',
  oplog: '查看随仓库提交的 append-only 操作记录。',
  server: '管理工作台端口、预览端口和上传体积限制。',
  git: '配置默认分支、提交身份和自动提交策略。',
  rules: '控制基线、变更日志和离线归档相关的业务约束。',
  integrations: '配置反馈流向、MCP 外部需求接入、通知平台、更新清单和镜像刷新。',
  ui: '设置需求链接模板、常用标签和时间显示方式。'
}

const byKey = (k) => items.value.find((i) => i.key === k)
const lanOn = computed(() => { const i = byKey('server.lan'); return i ? i.value : false })
const readonlyOn = computed(() => { const i = byKey('server.readonlyFromLan'); return i ? i.value : true })
const updateStatusTitle = computed(() => {
  if (!softwareUpdate.value.tracked) return '当前软件目录不可自动更新'
  if (softwareUpdate.value.dirty) return '软件目录存在本地改动'
  if (softwareUpdate.value.available) return '检测到可用更新'
  return '当前已是最新版本'
})
const updateStatusText = computed(() => {
  if (!softwareUpdate.value.tracked) return '需要从 Git 克隆的 Flowlark 软件目录启动，才能使用远端拉取更新。'
  if (softwareUpdate.value.dirty) return '请先提交、暂存或清理软件目录里的本地改动，再执行自动更新。'
  if (softwareUpdate.value.available) {
    const behind = softwareUpdate.value.behind ? `远端领先 ${softwareUpdate.value.behind} 个提交。` : ''
    return `${behind}点击“拉取并更新”后会执行快进更新，完成后请重启 Flowlark。`
  }
  const checkedAt = softwareUpdate.value.checkedAt ? `最近检测：${fmtTime(softwareUpdate.value.checkedAt)}` : '点击“检测更新”可重新拉取远端状态。'
  return checkedAt
})

// 局域网两项已经在上面的卡片里单独呈现了，分组列表里不重复
const HOISTED = new Set([
  'server.lan', 'server.readonlyFromLan', 'git.remote',
  'integrations.requirementProvider', 'integrations.requirementBaseUrl', 'integrations.requirementProject',
  'integrations.requirementSearchPath', 'integrations.requirementDetailPath', 'integrations.requirementCommentPath'
])

const groups = computed(() =>
  Object.entries(GROUP_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      items: items.value.filter((i) => i.group === key && !HOISTED.has(i.key))
    }))
    .filter((g) => g.items.length)
)

const sections = computed(() => [
  {
    key: 'workspace',
    label: '工作区',
    icon: IconApps,
    description: SECTION_DESCRIPTIONS.workspace,
    modified: 0
  },
  {
    key: 'softwareUpdate',
    label: '软件更新',
    icon: IconRefresh,
    description: SECTION_DESCRIPTIONS.softwareUpdate,
    modified: softwareUpdate.value.available ? 1 : 0
  },
  {
    key: 'mcp',
    label: 'MCP 中心',
    icon: IconCode,
    description: SECTION_DESCRIPTIONS.mcp,
    modified: mcpExists.value ? 1 : 0
  },
  {
    key: 'lan',
    label: '局域网分享',
    icon: IconShareExternal,
    description: SECTION_DESCRIPTIONS.lan,
    modified: modifiedCount(['server.lan', 'server.readonlyFromLan'])
  },
  {
    key: 'gitRemote',
    label: 'Git 远端',
    icon: IconBranch,
    description: SECTION_DESCRIPTIONS.gitRemote,
    modified: modifiedCount(['git.remote'])
  },
  {
    key: 'oplog',
    label: '操作日志',
    icon: IconHistory,
    description: SECTION_DESCRIPTIONS.oplog,
    modified: 0
  },
  ...groups.value.map((g) => ({
    key: g.key,
    label: g.label,
    icon: groupIcon(g.key),
    description: SECTION_DESCRIPTIONS[g.key] || '',
    modified: g.items.filter((item) => !item.isDefault).length
  }))
])

const activeMeta = computed(() =>
  sections.value.find((section) => section.key === activeSection.value) || sections.value[0]
)

const visibleGroups = computed(() => groups.value.filter((g) => g.key === activeSection.value))
const mcpFile = computed(() => mcpInfo.value.file || 'mcp.json')
const mcpExists = computed(() => !!mcpInfo.value.exists)
const mcpProblems = computed(() => mcpInfo.value.problems || [])
const mcpServers = computed(() => mcpInfo.value.config?.servers || [])
const mcpEnabledCapabilities = computed(() =>
  Object.values(mcpInfo.value.config?.capabilities || {}).filter((capability) => capability?.enabled)
)
const mcpCustomCapabilities = computed(() =>
  Object.entries(mcpInfo.value.config?.capabilities || {})
    .filter(([name]) => !['requirements', 'milestones'].includes(name))
    .map(([name, capability]) => ({ name, capability }))
)

async function load() {
  loading.value = true
  try {
    const [cfg, lan, remote] = await Promise.all([
      api.getConfig(),
      api.lan().catch(() => null),
      api.getRemote().catch(() => null)
    ])
    items.value = cfg.items
    problems.value = cfg.problems
    lanInfo.value = lan
    currentRemote.value = remote
    remoteUrl.value = remote ? remote.url : ''
    await Promise.all([loadWorkspaces(), loadSoftwareUpdate(), loadMcpConfig()])
  } finally {
    loading.value = false
  }
}

function defaultMcpServer() {
  return {
    id: '',
    name: '',
    type: 'http',
    enabled: true,
    url: '',
    timeoutMs: 10000,
    headersText: '{\n  "Authorization": "Bearer ${secret}"\n}'
  }
}

function defaultMcpRequirement() {
  return {
    enabled: false,
    server: '',
    project: '',
    tools: {
      test: 'requirements.test',
      search: 'requirements.search',
      get: 'requirements.get',
      comment: 'requirements.comment'
    }
  }
}

function defaultMcpMilestone() {
  return {
    enabled: false,
    server: '',
    project: '',
    tools: {
      test: 'milestones.test',
      list: 'milestones.list',
      get: 'milestones.get',
      upsert: 'milestones.upsert'
    }
  }
}

function defaultMcpExtension() {
  return {
    name: '',
    enabled: false,
    server: '',
    label: '',
    category: 'extension',
    description: '',
    project: '',
    toolsText: '{\n  "test": ""\n}'
  }
}

async function loadMcpConfig() {
  mcpLoading.value = true
  try {
    const info = await api.getMcpConfig()
    mcpInfo.value = info
    const req = info.config?.capabilities?.requirements || defaultMcpRequirement()
    const milestone = info.config?.capabilities?.milestones || defaultMcpMilestone()
    mcpRequirement.value = {
      ...defaultMcpRequirement(),
      ...req,
      tools: { ...defaultMcpRequirement().tools, ...(req.tools || {}) }
    }
    mcpMilestone.value = {
      ...defaultMcpMilestone(),
      ...milestone,
      tools: { ...defaultMcpMilestone().tools, ...(milestone.tools || {}) }
    }
    if (mcpExtensionForm.value.name) {
      const cap = info.config?.capabilities?.[mcpExtensionForm.value.name]
      if (cap) editMcpExtension(mcpExtensionForm.value.name, cap)
      else newMcpExtension()
    }
  } finally {
    mcpLoading.value = false
  }
}

function newMcpServer() {
  mcpEditingExisting.value = false
  mcpSecret.value = ''
  mcpServerForm.value = defaultMcpServer()
}

function editMcpServer(item) {
  mcpEditingExisting.value = true
  mcpSecret.value = ''
  mcpServerForm.value = {
    ...defaultMcpServer(),
    ...item,
    headersText: JSON.stringify(item.headers || {}, null, 2)
  }
}

async function saveMcpServer() {
  if (!mcpServerForm.value.id.trim()) return notify.warning('请填写 MCP 服务标识')
  if (!mcpServerForm.value.url.trim()) return notify.warning('请填写 MCP URL')
  let headers
  try {
    headers = JSON.parse(mcpServerForm.value.headersText || '{}')
  } catch {
    return notify.error('请求头 JSON 不合法')
  }
  mcpSaving.value = true
  try {
    mcpInfo.value = await api.saveMcpServer(mcpServerForm.value.id.trim(), {
      name: mcpServerForm.value.name,
      type: mcpServerForm.value.type,
      enabled: mcpServerForm.value.enabled,
      url: mcpServerForm.value.url,
      timeoutMs: mcpServerForm.value.timeoutMs,
      headers
    })
    notify.success('MCP 服务已保存')
    editMcpServer(mcpInfo.value.config.servers.find((item) => item.id === mcpServerForm.value.id.trim()))
  } finally {
    mcpSaving.value = false
  }
}

function removeMcpServer(id) {
  confirmDanger({
    title: '删除 MCP 服务？',
    content: id,
    okText: '删除',
    okType: 'danger',
    onOk: async () => {
      mcpInfo.value = await api.removeMcpServer(id)
      if (mcpServerForm.value.id === id) newMcpServer()
      notify.success('MCP 服务已删除')
    }
  })
}

async function saveMcpSecret() {
  await api.setMcpServerSecret(mcpServerForm.value.id, mcpSecret.value)
  mcpSecret.value = ''
  notify.success('MCP 密钥已保存到本机')
}

async function deleteMcpSecret() {
  await api.deleteMcpServerSecret(mcpServerForm.value.id)
  notify.success('MCP 密钥已删除')
}

async function saveMcpRequirement() {
  mcpSaving.value = true
  try {
    mcpInfo.value = await api.saveMcpCapability('requirements', mcpRequirement.value)
    notify.success('需求 MCP 映射已保存')
  } finally {
    mcpSaving.value = false
  }
}

async function testMcpRequirement() {
  mcpTesting.value = true
  try {
    const result = await api.testMcpCapability('requirements')
    notify.success(result.identity ? `连接成功：${result.identity}` : '连接成功')
  } finally {
    mcpTesting.value = false
  }
}

async function saveMcpMilestone() {
  mcpSaving.value = true
  try {
    mcpInfo.value = await api.saveMcpCapability('milestones', mcpMilestone.value)
    notify.success('迭代 MCP 映射已保存')
  } finally {
    mcpSaving.value = false
  }
}

async function testMcpMilestone() {
  mcpTesting.value = true
  try {
    const result = await api.testMcpCapability('milestones')
    notify.success(result.identity ? `连接成功：${result.identity}` : '连接成功')
  } finally {
    mcpTesting.value = false
  }
}

function newMcpExtension() {
  mcpExtensionEditing.value = false
  mcpExtensionForm.value = defaultMcpExtension()
}

function editMcpExtension(name, capability) {
  mcpExtensionEditing.value = true
  mcpExtensionForm.value = {
    ...defaultMcpExtension(),
    ...capability,
    name,
    toolsText: JSON.stringify(capability.tools || { test: '' }, null, 2)
  }
}

async function saveMcpExtension() {
  const name = mcpExtensionForm.value.name.trim()
  if (!name) return notify.warning('请填写 MCP 能力标识')
  if (['requirements', 'milestones'].includes(name)) return notify.warning('内置能力请在上方区域编辑')
  let tools
  try {
    tools = JSON.parse(mcpExtensionForm.value.toolsText || '{}')
  } catch {
    return notify.error('工具映射 JSON 不合法')
  }
  mcpSaving.value = true
  try {
    mcpInfo.value = await api.saveMcpCapability(name, {
      enabled: mcpExtensionForm.value.enabled,
      server: mcpExtensionForm.value.server,
      label: mcpExtensionForm.value.label,
      category: mcpExtensionForm.value.category,
      description: mcpExtensionForm.value.description,
      project: mcpExtensionForm.value.project,
      tools
    })
    notify.success('扩展 MCP 能力已保存')
    editMcpExtension(name, mcpInfo.value.config.capabilities[name])
  } finally {
    mcpSaving.value = false
  }
}

async function testMcpExtension() {
  if (!mcpExtensionForm.value.name.trim()) return notify.warning('请先选择或填写 MCP 能力')
  if (!mcpInfo.value.config?.capabilities?.[mcpExtensionForm.value.name.trim()]) await saveMcpExtension()
  mcpTesting.value = true
  try {
    const result = await api.testMcpCapability(mcpExtensionForm.value.name.trim())
    notify.success(result.identity ? `连接成功：${result.identity}` : '连接成功')
  } finally {
    mcpTesting.value = false
  }
}

function removeMcpExtension(name) {
  confirmDanger({
    title: '删除扩展 MCP 能力？',
    content: name,
    okText: '删除',
    okType: 'danger',
    onOk: async () => {
      mcpInfo.value = await api.removeMcpCapability(name)
      if (mcpExtensionForm.value.name === name) newMcpExtension()
      notify.success('扩展 MCP 能力已删除')
    }
  })
}

async function loadSoftwareUpdate({ fetchRemote = false } = {}) {
  softwareUpdate.value = await api.softwareUpdateStatus({ fetchRemote }).catch((e) => ({
    tracked: false,
    currentVersion: app.version,
    error: e.message
  }))
}

async function checkSoftwareUpdate() {
  updateChecking.value = true
  try {
    await loadSoftwareUpdate({ fetchRemote: true })
    if (softwareUpdate.value.available) notify.success('检测到可用更新')
    else if (!softwareUpdate.value.error) notify.success('当前已是最新版本')
  } finally {
    updateChecking.value = false
  }
}

function confirmSoftwareUpdate() {
  confirmDanger({
    title: '拉取软件更新？',
    content: '更新会从当前软件目录的 Git 上游远端执行 fast-forward pull。完成后请重启 Flowlark，让新代码和前端资源生效。',
    okText: '拉取并更新',
    onOk: applySoftwareUpdate
  })
}

async function applySoftwareUpdate() {
  updateApplying.value = true
  try {
    const result = await api.pullSoftwareUpdate()
    softwareUpdate.value = result.after || softwareUpdate.value
    notify.success(result.message || '软件更新已完成，请重启 Flowlark')
  } finally {
    updateApplying.value = false
  }
}

function bytesText(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

function groupIcon(key) {
  return GROUP_ICONS[key] || IconExperiment
}

function modifiedCount(keys) {
  return keys.map(byKey).filter((item) => item && !item.isDefault).length
}

function numberMin(item) {
  return item.min ?? 1
}

function numberMax(item) {
  if (item.max != null) return item.max
  return item.type === 'port' ? 65535 : undefined
}

function selectSection(key) {
  activeSection.value = key
  if (!props.embedded && route.params.section !== key) {
    router.replace(key === 'workspace' ? '/settings' : `/settings/${key}`)
  }
}

async function save(key, value) {
  try {
    const r = await api.setConfig(key, value)
    if (r.needsRestart) restartNeeded.value = true
    for (const p of r.problems || []) notify.warning(p)
    for (const s of r.sideEffects || []) notify.info(s)
    await load()
    await app.load()
  } catch {
    await load() // 失败时回到服务端的真实状态，不留下假的界面值
  }
}

/** 高风险开关关掉之前先说清楚后果，而不是让人事后才发现规则失效了 */
function confirmSave(item, value) {
  if (item.danger && value === false) {
    return confirmDanger({
      title: `确定关闭「${item.label}」？`,
      content: item.note,
      okText: '确定关闭',
      okType: 'danger',
      onOk: () => save(item.key, value)
    })
  }
  save(item.key, value)
}

async function toggleLan(value) {
  lanBusy.value = true
  try {
    await save('server.lan', value)
    lanInfo.value = await api.lan()
  } finally {
    lanBusy.value = false
  }
}

async function reset(key) {
  await api.resetConfig(key)
  await load()
}

async function saveRemote() {
  await api.setRemote(remoteUrl.value.trim())
  notify.success('远端已保存')
  await load()
}

async function clearRemote() {
  await api.removeRemote()
  notify.success('远端已移除')
  await load()
}

async function loadWorkspaces() {
  workspaceLoading.value = true
  try {
    workspaces.value = await api.listWorkspaces()
  } finally {
    workspaceLoading.value = false
  }
}

async function saveWorkspace() {
  if (!workspaceForm.value.path) return notify.warning('请填写本机目录')
  if (workspaceMode.value === 'clone' && !workspaceForm.value.url) return notify.warning('请填写 Git 地址')
  workspaceSaving.value = true
  try {
    const body = {
      path: workspaceForm.value.path,
      name: workspaceForm.value.name,
      mode: workspaceForm.value.mirror ? 'mirror' : 'normal'
    }
    if (workspaceMode.value === 'clone') await api.cloneWorkspace({ ...body, url: workspaceForm.value.url })
    else await api.registerWorkspace(body)
    notify.success('工作区已保存')
    workspaceForm.value = { url: '', path: '', name: '', mirror: false }
    await loadWorkspaces()
  } finally {
    workspaceSaving.value = false
  }
}

function removeWorkspace(path) {
  confirmDanger({
    title: '移除工作区？',
    content: path,
    okText: '移除',
    okType: 'danger',
    onOk: async () => {
      await api.removeWorkspace(path)
      notify.success('工作区已移除')
      await loadWorkspaces()
    }
  })
}

async function rebuildWorkspaceIndex() {
  indexing.value = true
  try {
    const result = await api.buildWorkspaceIndex()
    notify.success(`索引已重建，共 ${result.records.length} 条记录`)
  } finally {
    indexing.value = false
  }
}

function copy(text) {
  navigator.clipboard.writeText(text)
    .then(() => notify.success('已复制'))
    .catch(() => notify.error('复制失败，请手动选中'))
}

function fmtTime(value) {
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

function syncSectionFromRoute() {
  if (props.embedded) return
  const section = typeof route.params.section === 'string' ? route.params.section : 'workspace'
  if (sections.value.some((item) => item.key === section)) activeSection.value = section
}

onMounted(async () => {
  await load()
  syncSectionFromRoute()
})

watch(() => route.params.section, syncSectionFromRoute)
</script>

<style>
.settings-panel-embedded {
  padding: 0 2px 2px;
}
.settings-layout {
  display: grid;
  grid-template-columns: 172px minmax(0, 1fr);
  align-items: start;
  gap: var(--fl-s-4);
}
.settings-nav {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--fl-s-1);
  padding: var(--fl-s-2);
  background: var(--fl-surface-2);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
}
.settings-nav-item {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--fl-s-2);
  border: 0;
  border-radius: var(--fl-r-2);
  background: transparent;
  color: var(--fl-text-2);
  cursor: pointer;
  font-size: var(--fl-fs-3);
  text-align: left;
}
.settings-nav-item:hover {
  background: var(--fl-surface-3);
  color: var(--fl-ink);
}
.settings-nav-item-active {
  background: #EEF8F5;
  color: var(--fl-ink);
  box-shadow: inset 3px 0 0 var(--fl-primary), inset 0 0 0 1px rgba(14,147,132,.12);
}
.settings-nav-item svg,
.card-title svg,
.settings-current svg {
  width: 16px;
  height: 16px;
}
.settings-content {
  min-width: 0;
}
.settings-current {
  min-height: 54px;
  display: flex;
  align-items: center;
  gap: var(--fl-s-3);
  padding: 0 var(--fl-s-4);
  margin-bottom: var(--fl-s-3);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface);
  box-shadow: var(--fl-shadow-1);
}
.settings-current svg {
  color: var(--fl-primary-deep);
}
.settings-current-title {
  font-size: var(--fl-fs-4);
  font-weight: 650;
  color: var(--fl-ink);
}
.settings-section {
  margin-bottom: var(--fl-s-4);
}
.card-title {
  display: inline-flex;
  align-items: center;
  gap: var(--fl-s-2);
  color: var(--fl-ink);
}
.inline-setting {
  display: flex;
  align-items: flex-start;
  gap: var(--fl-s-3);
}
.remote-input {
  width: calc(100% - 160px);
}
.cfg-row {
  display: flex; align-items: flex-start; gap: 20px;
  padding: 14px 0; border-bottom: 1px solid #fafafa;
}
.cfg-row:last-child { border-bottom: none; }
.cfg-control { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.settings-tabs {
  margin-bottom: var(--fl-s-3);
}
.workspace-form {
  max-width: 640px;
}
.current-workspace-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fl-s-3);
  padding: var(--fl-s-3);
  margin-bottom: var(--fl-s-3);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface-2);
}
.current-workspace-main {
  display: flex;
  align-items: center;
  gap: var(--fl-s-3);
  min-width: 0;
}
.current-workspace-main svg {
  color: var(--fl-primary-deep);
  flex: 0 0 auto;
}
.current-workspace-title {
  font-weight: 650;
  color: var(--fl-ink);
}
.current-workspace-path {
  max-width: 430px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
}
.workspace-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: var(--fl-s-3);
}
.lan-addr {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  background: #fafafa; border-radius: 6px; margin-bottom: 8px;
}
.update-info-card,
.update-status-card,
.update-notes {
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface-2);
  padding: var(--fl-s-3);
  margin-bottom: var(--fl-s-3);
}
.update-info-row {
  display: grid;
  grid-template-columns: 150px minmax(0, 1fr);
  gap: var(--fl-s-3);
  align-items: start;
  padding: 6px 0;
}
.update-info-row span {
  color: var(--fl-text-2);
}
.update-path {
  overflow-wrap: anywhere;
}
.update-status-card {
  display: flex;
  align-items: flex-start;
  gap: var(--fl-s-3);
  background: var(--fl-surface);
}
.update-status-card svg {
  color: var(--fl-text-2);
  margin-top: 2px;
}
.update-status-card-ready {
  border-color: var(--fl-primary-border);
  background: var(--fl-primary-bg);
}
.update-status-card-ready svg {
  color: var(--fl-primary-deep);
}
.update-notes pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--fl-text-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: var(--fl-fs-2);
  line-height: 1.75;
}
.update-actions {
  margin-top: var(--fl-s-1);
}
.mcp-summary-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--fl-s-3);
  margin-bottom: var(--fl-s-4);
}
.mcp-summary-item {
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface-2);
  padding: var(--fl-s-3);
}
.mcp-summary-value {
  color: var(--fl-ink);
  font-size: var(--fl-fs-5);
  font-weight: 700;
  line-height: 1.4;
}
.mcp-grid {
  display: grid;
  grid-template-columns: minmax(280px, .9fr) minmax(320px, 1.1fr);
  gap: var(--fl-s-4);
}
.mcp-subtitle {
  font-weight: 650;
  margin-bottom: var(--fl-s-2);
}
.mcp-form-grid,
.mcp-tools-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--fl-s-3);
}
.mcp-url {
  font-size: var(--fl-fs-2);
  overflow-wrap: anywhere;
}
.mcp-advanced,
.mcp-extensions {
  margin-top: var(--fl-s-3);
}
.mcp-extensions {
  border-top: 1px solid var(--fl-line);
  padding-top: var(--fl-s-2);
}
@media (max-width: 760px) {
  .settings-layout {
    display: block;
  }
  .settings-nav {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: var(--fl-s-3);
  }
  .settings-nav-item-active {
    box-shadow: inset 0 0 0 1px rgba(14,147,132,.28);
  }
  .cfg-row {
    display: block;
  }
  .cfg-control {
    margin-top: var(--fl-s-3);
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .remote-input {
    width: 100%;
  }
  .workspace-form-grid {
    display: block;
  }
  .current-workspace-card {
    align-items: flex-start;
    flex-direction: column;
  }
  .current-workspace-path {
    max-width: min(100%, 420px);
    white-space: normal;
    word-break: break-all;
  }
  .update-info-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
  .mcp-grid,
  .mcp-summary-grid,
  .mcp-form-grid,
  .mcp-tools-grid {
    grid-template-columns: 1fr;
  }
}
</style>
