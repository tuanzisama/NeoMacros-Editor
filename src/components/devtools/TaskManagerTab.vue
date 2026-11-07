<script setup lang="ts">
/** DevTools 任务页签：复用共享任务表格（store 与列配置同主视图一体）。 */
import TaskTable from '@/components/tasks/TaskTable.vue'
</script>

<template>
  <div class="tasks-tab">
    <TaskTable />
  </div>
</template>

<style scoped>
.tasks-tab {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
