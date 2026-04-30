import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    console.log('Starting database seed...');
    // 创建默认系统配置
    await prisma.systemConfig.upsert({
        where: { key: 'api_key' },
        update: {},
        create: {
            key: 'api_key',
            value: '',
        },
    });
    await prisma.systemConfig.upsert({
        where: { key: 'api_base_url' },
        update: {},
        create: {
            key: 'api_base_url',
            value: 'https://api.deepseek.com',
        },
    });
    await prisma.systemConfig.upsert({
        where: { key: 'default_model' },
        update: {},
        create: {
            key: 'default_model',
            value: 'deepseek-chat',
        },
    });
    // 创建内置网络巡检 Skill
    const inspectionSkill = await prisma.skill.upsert({
        where: { name: 'network-inspection' },
        update: {},
        create: {
            name: 'network-inspection',
            version: '1.0.0',
            description: '网络设备巡检工具集，支持连接网络设备、执行CLI命令、解析输出结果',
            author: 'NetOps Team',
            tags: JSON.stringify(['network', 'inspection', 'maintenance']),
            tools: JSON.stringify([
                {
                    name: 'connect_device',
                    description: '建立与网络设备的SSH连接',
                    parameters: {
                        type: 'object',
                        properties: {
                            host: {
                                type: 'string',
                                description: '设备IP地址或主机名',
                            },
                            port: {
                                type: 'number',
                                description: 'SSH端口号',
                                default: 22,
                            },
                            username: {
                                type: 'string',
                                description: '登录用户名',
                            },
                            password: {
                                type: 'string',
                                description: '登录密码',
                            },
                        },
                        required: ['host', 'username', 'password'],
                    },
                    handler: 'network.connectDevice',
                },
                {
                    name: 'execute_command',
                    description: '在已连接的设备上执行CLI命令',
                    parameters: {
                        type: 'object',
                        properties: {
                            command: {
                                type: 'string',
                                description: '要执行的CLI命令',
                            },
                        },
                        required: ['command'],
                    },
                    handler: 'network.executeCommand',
                },
                {
                    name: 'disconnect_device',
                    description: '断开与网络设备的连接',
                    parameters: {
                        type: 'object',
                        properties: {},
                        required: [],
                    },
                    handler: 'network.disconnectDevice',
                },
            ]),
            configurations: JSON.stringify([
                {
                    key: 'timeout',
                    type: 'number',
                    description: '命令执行超时时间（秒）',
                    default: 30,
                    required: false,
                },
            ]),
            icon: '🔧',
            builtIn: true,
        },
    });
    // 创建内置 Agent Skill 配置
    const agentSkill = await prisma.agentSkill.upsert({
        where: {
            agentId_skillId: {
                agentId: 'builtin-network-inspector',
                skillId: inspectionSkill.id,
            },
        },
        update: {},
        create: {
            agentId: 'builtin-network-inspector',
            skillId: inspectionSkill.id,
            enabled: true,
        },
    });
    // 创建预置网络巡检助手
    const inspectorAgent = await prisma.agent.upsert({
        where: { id: 'builtin-network-inspector' },
        update: {},
        create: {
            id: 'builtin-network-inspector',
            name: '网络巡检助手',
            description: '专业的网络设备巡检助手，帮助运维工程师快速完成设备状态检查',
            systemPrompt: `你是一名资深网络运维工程师，负责执行网络设备巡检任务。

请按照以下流程执行：
1. 连接目标设备（使用 connect_device 工具）
2. 执行巡检命令：
   - show version - 查看设备版本信息
   - show interface brief - 查看端口概要
   - show log - 查看系统日志
   - show cpu usage - 查看CPU使用率
   - show memory - 查看内存使用情况
3. 分析输出结果，识别异常
4. 生成巡检报告

注意事项：
- 保持专业的技术术语
- 发现问题时给出具体建议
- 报告格式清晰易读`,
            modelConfig: JSON.stringify({
                model: 'deepseek-chat',
                temperature: 0.7,
                maxTokens: 2048,
            }),
            enabled: true,
        },
    });
    console.log('Seed completed successfully!');
    console.log(`Created/Updated Agent: ${inspectorAgent.name}`);
    console.log(`Created/Updated Skill: ${inspectionSkill.name}`);
}
main()
    .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map